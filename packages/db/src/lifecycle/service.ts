import {
	createHash,
	createHmac,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ResourceError, type ResourceHooks } from "../resources";
import {
	appendTenantAudit,
	assertAuthorizationCurrent,
	type MembershipRole,
	type TenantActor,
	transitionMembership,
} from "../tenancy";

export interface DeletionRow {
	id: string;
	subject_kind: "account" | "organization";
	subject_id: string;
	requester_id: string;
	operation_key: string;
	status_hash: string;
	state:
		| "awaiting_prerequisites"
		| "journal_pending"
		| "scheduled"
		| "purging"
		| "complete"
		| "canceled";
	organizations: string[];
	resolutions: {
		organizationId: string;
		successorUserId: string;
		transferId: string | null;
	}[];
	retained: string[];
	steps: string[];
	journal_sequence: number | null;
	effective_at: Date | null;
	completed_at: Date | null;
}
export interface LifecycleJournal {
	append(
		key: string,
		record: {
			version: 1;
			requestId: string;
			subjectKind: "account" | "organization";
			subjectId: string;
			action: "scheduled" | "progress" | "completed";
			effectiveAt: string;
			retained: readonly string[];
			statusHash?: string;
			organizations: readonly string[];
			resolutions?: readonly {
				organizationId: string;
				successorUserId: string;
				transferId: string | null;
			}[];
			steps: readonly string[];
		},
	): Promise<{ sequence: number }>;
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const dto = (r: DeletionRow) => ({
	id: r.id,
	subjectKind: r.subject_kind,
	state: r.state,
	retained: r.retained,
	steps: r.steps,
	effectiveAt: r.effective_at?.toISOString() ?? null,
	completedAt: r.completed_at?.toISOString() ?? null,
	backupExpiry: "not-confirmed" as const,
});
function fresh(a: TenantActor) {
	if (
		"kind" in a ||
		!a.assertCurrent ||
		!Number.isFinite(a.authenticatedAt.getTime()) ||
		a.authenticatedAt.getTime() > Date.now() ||
		Date.now() - a.authenticatedAt.getTime() > 300000
	)
		throw new ResourceError("DENIED");
}
async function transaction<T>(
	pool: Pool,
	userId: string,
	work: (c: PoolClient) => Promise<T>,
) {
	const c = await pool.connect();
	try {
		await c.query("BEGIN");
		await c.query("SELECT pg_advisory_xact_lock_shared(1849202603)");
		await c.query(
			"SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='8s'",
		);
		await c.query(
			"SELECT pg_advisory_xact_lock(hashtextextended($1,0)),set_config('app.authorization_expires_at','',true)",
			[`user:${userId}`],
		);
		const result = await work(c);
		await assertAuthorizationCurrent(c);
		await c.query("COMMIT");
		return result;
	} catch (e) {
		await c.query("ROLLBACK");
		throw e;
	} finally {
		c.release();
	}
}
async function fence(c: PoolClient, org: string) {
	await c.query(
		"SELECT set_config('app.organization_id',$1,true),pg_advisory_xact_lock(hashtextextended($2,0))",
		[org, `organization:${org}`],
	);
	await c.query("SELECT id FROM tenancy.organizations WHERE id=$1 FOR UPDATE", [
		org,
	]);
	await c.query(
		"SELECT organization_id FROM tenancy.seat_capacities WHERE organization_id=$1 FOR UPDATE",
		[org],
	);
}
export function createLifecycleService(
	pool: Pool,
	hooks: Pick<ResourceHooks, "authorize" | "sourceCommit">,
	options: { secret: string; journal: LifecycleJournal },
) {
	const token = (id: string) =>
		createHmac("sha256", options.secret)
			.update(`deletion-status:${id}`)
			.digest("base64url");
	async function own(c: PoolClient, a: TenantActor) {
		fresh(a);
		const deadline = await a.assertCurrent?.();
		if (deadline)
			await c.query(
				"SELECT set_config('app.authorization_expires_at',$1,true)",
				[deadline.toISOString()],
			);
		const u = (
			await c.query("SELECT * FROM identity.lookup_user($1)", [a.userId])
		).rows[0];
		if (u?.lifecycle_status !== "active" || !u.email_verified)
			throw new ResourceError("DENIED");
	}
	async function obligations(c: PoolClient, user: string) {
		const ids = (
			await c.query<{ organization_id: string }>(
				"SELECT * FROM foundation.account_organizations($1)",
				[user],
			)
		).rows.map((r) => r.organization_id);
		if (ids.length > 1000) throw new ResourceError("CAPACITY");
		const items: {
			organizationId: string;
			membershipId: string;
			name: string;
			role: string;
			requiresSuccessor: boolean;
		}[] = [];
		// Acquire all org fences in sorted order before inspecting continuity.
		for (const org of ids) await fence(c, org);
		for (const org of ids) {
			await c.query("SELECT set_config('app.organization_id',$1,true)", [org]);
			const m = (
				await c.query(
					`SELECT m.*,o.name,o.status AS org_status FROM tenancy.memberships m JOIN tenancy.organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2`,
					[org, user],
				)
			).rows[0];
			const successor = (
				await c.query(
					`SELECT m.id FROM tenancy.memberships m CROSS JOIN LATERAL identity.lookup_user(m.user_id) u WHERE m.organization_id=$1 AND m.user_id<>$2 AND m.role='owner' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) AND u.lifecycle_status='active' AND u.email_verified LIMIT 1`,
					[org, user],
				)
			).rowCount;
			const deleted = (
				await c.query(
					"SELECT 1 FROM foundation.deletion_requests WHERE subject_kind='organization' AND subject_id=$1 AND state='complete'",
					[org],
				)
			).rowCount;
			items.push({
				organizationId: org,
				membershipId: m.id,
				name: m.name,
				role: m.role,
				requiresSuccessor:
					m.role === "owner" && m.status === "active" && !successor && !deleted,
			});
		}
		return items;
	}
	async function acknowledge(id: string) {
		const r = (
			await pool.query<DeletionRow>(
				"SELECT * FROM foundation.deletion_requests WHERE id=$1",
				[id],
			)
		).rows[0];
		if (r?.state !== "journal_pending") return;
		const ack = await options.journal.append(`${id}:scheduled`, {
			version: 1,
			requestId: id,
			subjectKind: r.subject_kind,
			subjectId: r.subject_id,
			action: "scheduled",
			effectiveAt: r.effective_at?.toISOString() ?? "",
			retained: r.retained,
			organizations: r.organizations,
			resolutions: r.resolutions,
			statusHash: r.status_hash,
			steps: r.steps,
		});
		await pool.query(
			"UPDATE foundation.deletion_requests SET journal_sequence=$2,state='scheduled' WHERE id=$1 AND state='journal_pending'",
			[id, ack.sequence],
		);
	}
	return {
		async personalExport(a: TenantActor) {
			return transaction(pool, a.userId, async (c) => {
				await own(c, a);
				const profile = (
					await c.query("SELECT foundation.personal_export($1) AS data", [
						a.userId,
					])
				).rows[0].data;
				const memberships = await obligations(c, a.userId);
				return {
					filename: "my-account.json",
					contentType: "application/json",
					base64: Buffer.from(
						JSON.stringify({ version: 1, profile, memberships }),
					).toString("base64"),
				};
			});
		},
		acknowledge,
		async preview(a: TenantActor) {
			return transaction(pool, a.userId, async (c) => {
				await own(c, a);
				return obligations(c, a.userId);
			});
		},
		async request(
			a: TenantActor,
			input: {
				kind: "account" | "organization";
				organizationId?: string;
				operationKey: string;
			},
		) {
			if (
				!/^[a-zA-Z0-9_-]{8,120}$/.test(input.operationKey) ||
				!["account", "organization"].includes(input.kind)
			)
				throw new ResourceError("INVALID");
			return transaction(pool, a.userId, async (c) => {
				await own(c, a);
				const subject =
					input.kind === "account" ? a.userId : input.organizationId;
				if (!subject) throw new ResourceError("INVALID");
				if (input.kind === "organization") {
					await fence(c, subject);
					await hooks.authorize(
						c,
						a,
						subject,
						{ type: "organization", id: subject },
						"manage",
					);
					const owner = (
						await c.query(
							"SELECT 1 FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2 AND role='owner' AND status='active'",
							[subject, a.userId],
						)
					).rowCount;
					if (!owner) throw new ResourceError("DENIED");
				}
				let r = (
					await c.query<DeletionRow>(
						"SELECT * FROM foundation.deletion_requests WHERE requester_id=$1 AND operation_key=$2",
						[a.userId, input.operationKey],
					)
				).rows[0];
				if (r && (r.subject_id !== subject || r.subject_kind !== input.kind))
					throw new ResourceError("CONFLICT");
				if (!r) {
					const id = randomUUID();
					r = (
						await c.query<DeletionRow>(
							"INSERT INTO foundation.deletion_requests(id,subject_kind,subject_id,requester_id,operation_key,status_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
							[
								id,
								input.kind,
								subject,
								a.userId,
								input.operationKey,
								digest(token(id)),
							],
						)
					).rows[0];
				}
				return { ...dto(r), receipt: token(r.id) };
			});
		},
		async cancel(a: TenantActor, id: string) {
			return transaction(pool, a.userId, async (c) => {
				await own(c, a);
				const r = (
					await c.query<DeletionRow>(
						"UPDATE foundation.deletion_requests SET state='canceled' WHERE id=$1 AND requester_id=$2 AND state='awaiting_prerequisites' RETURNING *",
						[id, a.userId],
					)
				).rows[0];
				if (!r) throw new ResourceError("CONFLICT");
				return dto(r);
			});
		},
		async confirm(a: TenantActor, id: string) {
			await transaction(pool, a.userId, async (c) => {
				await own(c, a);
				const r = (
					await c.query<DeletionRow>(
						"SELECT * FROM foundation.deletion_requests WHERE id=$1 AND requester_id=$2 FOR UPDATE",
						[id, a.userId],
					)
				).rows[0];
				if (r?.state !== "awaiting_prerequisites")
					throw new ResourceError("CONFLICT");
				if (r.subject_kind === "account") {
					const items = await obligations(c, a.userId);
					if (items.some((i) => i.requiresSuccessor))
						throw new ResourceError("CONFLICT");
					await c.query(
						"UPDATE foundation.deletion_requests SET organizations=$2,effective_at=clock_timestamp() WHERE id=$1",
						[id, JSON.stringify(items.map((i) => i.organizationId))],
					);
					const resolutions: {
						organizationId: string;
						successorUserId: string;
						transferId: string | null;
					}[] = [];
					for (const item of items) {
						await c.query("SELECT set_config('app.organization_id',$1,true)", [
							item.organizationId,
						]);
						const successor = (
							await c.query(
								"SELECT m.user_id,(SELECT t.id FROM tenancy.ownership_transfers t WHERE t.organization_id=m.organization_id AND t.recipient_membership_id=m.id AND t.status='accepted' ORDER BY t.accepted_at DESC LIMIT 1) AS transfer_id FROM tenancy.memberships m CROSS JOIN LATERAL identity.lookup_user(m.user_id) u WHERE m.organization_id=$1 AND m.user_id<>$2 AND m.role='owner' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) AND u.lifecycle_status='active' AND u.email_verified ORDER BY m.id LIMIT 1",
								[item.organizationId, a.userId],
							)
						).rows[0];
						if (successor)
							resolutions.push({
								organizationId: item.organizationId,
								successorUserId: successor.user_id,
								transferId: successor.transfer_id,
							});
					}
					await c.query(
						"UPDATE foundation.deletion_requests SET resolutions=$2 WHERE id=$1",
						[id, JSON.stringify(resolutions)],
					);
					await c.query("SELECT foundation.lifecycle_identity($1,false)", [id]);
					for (const item of items) {
						const org = item.organizationId;
						await c.query("SELECT set_config('app.organization_id',$1,true)", [
							org,
						]);
						const previous = (
							await c.query(
								"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND id=$2",
								[org, item.membershipId],
							)
						).rows[0];
						await transitionMembership(c, org, a.userId, {
							userId: a.userId,
							membershipId: item.membershipId,
							role: previous.role as MembershipRole,
							status: "inactive",
							billable: previous.billable,
							operationKey: `control:delete-${id}`,
							securityOverride: true,
						});
						await c.query(
							"DELETE FROM tenancy.team_members WHERE organization_id=$1 AND membership_id=$2",
							[org, item.membershipId],
						);
						await c.query(
							"DELETE FROM tenancy.resource_grants WHERE organization_id=$1 AND membership_id=$2",
							[org, item.membershipId],
						);
						await c.query(
							"UPDATE tenancy.projects SET owner_membership_id=NULL WHERE organization_id=$1 AND owner_membership_id=$2",
							[org, item.membershipId],
						);
						await c.query(
							"UPDATE tenancy.ownership_transfers SET status='canceled' WHERE organization_id=$1 AND status='pending' AND (initiator_membership_id=$2 OR recipient_membership_id=$2)",
							[org, item.membershipId],
						);
						await hooks.sourceCommit(c, org);
					}
				} else {
					const org = r.subject_id;
					await fence(c, org);
					await hooks.authorize(
						c,
						a,
						org,
						{ type: "organization", id: org },
						"manage",
					);
					if (
						!(
							await c.query(
								"SELECT 1 FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2 AND role='owner' AND status='active'",
								[org, a.userId],
							)
						).rowCount
					)
						throw new ResourceError("DENIED");
					await c.query(
						"UPDATE tenancy.organizations SET status='suspended' WHERE id=$1",
						[org],
					);
					await c.query(
						"UPDATE tenancy.api_keys SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE organization_id=$1",
						[org],
					);
					await c.query(
						"UPDATE tenancy.service_accounts SET status='inactive',version=version+1 WHERE organization_id=$1 AND status='active'",
						[org],
					);
					await c.query(
						"UPDATE foundation.deletion_requests SET organizations=$2,effective_at=clock_timestamp() WHERE id=$1",
						[id, JSON.stringify([org])],
					);
					await appendTenantAudit(
						c,
						org,
						a.userId,
						"organization.deletion_requested",
						id,
						{},
						undefined,
					);
					await hooks.sourceCommit(c, org);
				}
				await c.query(
					"UPDATE foundation.deletion_requests SET state='journal_pending' WHERE id=$1",
					[id],
				);
			});
			// An unavailable journal is a durable pending state; it never permits purge.
			try {
				await acknowledge(id);
			} catch {
				/* Reconciliation retries the same immutable event. */
			}
			return this.status(id, token(id));
		},
		async status(id: string, receipt: string) {
			if (!/^[a-f0-9-]{36}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(receipt))
				throw new ResourceError("DENIED");
			const r = (
				await pool.query<DeletionRow>(
					"SELECT * FROM foundation.deletion_requests WHERE id=$1",
					[id],
				)
			).rows[0];
			if (
				!r ||
				!timingSafeEqual(
					Buffer.from(digest(receipt)),
					Buffer.from(r.status_hash),
				)
			)
				throw new ResourceError("DENIED");
			return dto(r);
		},
	};
}

/** Provider receipts are explicit and repeatable. Returning false keeps cleanup pending. */
export interface DeletionCleanup {
	cleanup(
		request: DeletionRow,
		step: "files" | "analytics" | "billing" | "integrations" | "local",
	): Promise<boolean>;
}
export async function advanceDeletion(
	pool: Pool,
	journal: LifecycleJournal,
	cleanup: DeletionCleanup,
	id: string,
) {
	// Serialize one request across replicas while external operations use stable request IDs.
	const c = await pool.connect();
	try {
		await c.query("SET lock_timeout='5s'");
		await c.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
			`deletion:${id}`,
		]);
		let r = (
			await c.query<DeletionRow>(
				"SELECT * FROM foundation.deletion_requests WHERE id=$1",
				[id],
			)
		).rows[0];
		if (
			!r ||
			!["scheduled", "purging"].includes(r.state) ||
			!r.journal_sequence
		)
			return;
		await c.query(
			"UPDATE foundation.deletion_requests SET state='purging' WHERE id=$1",
			[id],
		);
		r = { ...r, state: "purging" };
		for (const step of [
			"files",
			"analytics",
			"billing",
			"integrations",
			"local",
		] as const) {
			if (r.steps.includes(step)) continue;
			if (!(await cleanup.cleanup(r, step))) return;
			const steps = [...r.steps, step];
			const ack = await journal.append(`${id}:step:${step}`, {
				version: 1,
				requestId: id,
				subjectKind: r.subject_kind,
				subjectId: r.subject_id,
				action: "progress",
				effectiveAt: r.effective_at?.toISOString() ?? "",
				retained: r.retained,
				organizations: r.organizations,
				resolutions: r.resolutions,
				statusHash: r.status_hash,
				steps,
			});
			await c.query(
				"UPDATE foundation.deletion_requests SET steps=$2,journal_sequence=$3 WHERE id=$1",
				[id, JSON.stringify(steps), ack.sequence],
			);
			r = { ...r, steps };
		}
		const ack = await journal.append(`${id}:completed`, {
			version: 1,
			requestId: id,
			subjectKind: r.subject_kind,
			subjectId: r.subject_id,
			action: "completed",
			effectiveAt: r.effective_at?.toISOString() ?? "",
			retained: r.retained,
			organizations: r.organizations,
			resolutions: r.resolutions,
			statusHash: r.status_hash,
			steps: r.steps,
		});
		await c.query(
			"UPDATE foundation.deletion_requests SET state='complete',completed_at=clock_timestamp(),journal_sequence=$2 WHERE id=$1",
			[id, ack.sequence],
		);
	} finally {
		await c
			.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
				`deletion:${id}`,
			])
			.catch(() => {});
		c.release();
	}
}
