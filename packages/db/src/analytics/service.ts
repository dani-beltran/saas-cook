import { createHash, createHmac } from "node:crypto";
import {
	type AnalyticsPreferenceInput,
	analyticsPreferenceInput,
} from "@saas-cook/api-contracts/inputs/analytics";
import type { Pool, PoolClient } from "pg";
import { ResourceError, type ResourceHooks } from "../resources";
import { type TenantActor, withTenantTransaction } from "../tenancy";
import type {
	AnalyticsDeletion,
	AnalyticsEvent,
	AnalyticsProvider,
} from "./provider";

export function createAnalyticsService(
	pool: Pool,
	hooks: Pick<ResourceHooks, "authorize">,
	options: {
		enabled: boolean;
		secret: string;
		synthetic: boolean;
		provider?: AnalyticsProvider;
		ready: (c: PoolClient) => Promise<unknown>;
		registry: {
			register(
				id: string,
				userId: string,
				organizationId: string | null,
				eventId: string,
			): Promise<void>;
			settle(eventId: string): Promise<void>;
			unsettled(subject: string): Promise<string[]>;
			list(
				kind: "account" | "organization",
				id: string,
			): Promise<
				{ id: string; user_id: string; organization_id: string | null }[]
			>;
		};
	},
) {
	const opaque = (s: string) =>
		createHmac("sha256", options.secret).update(s).digest("hex");
	async function lock(c: PoolClient, user: string, org: string | null) {
		for (const key of [
			`analytics:account:${user}`,
			...(org ? [`analytics:organization:${org}`] : []),
		].sort())
			await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
				key,
			]);
	}
	async function permitted(c: PoolClient, user: string, org: string | null) {
		if (!options.enabled) return false;
		const userRow = (
			await c.query("SELECT lifecycle_status FROM identity.lookup_user($1)", [
				user,
			])
		).rows[0];
		if (userRow?.lifecycle_status !== "active") return false;
		if (
			org &&
			!(
				await c.query(
					"SELECT 1 FROM tenancy.organizations WHERE id=$1 AND status='active'",
					[org],
				)
			).rowCount
		)
			return false;
		return !(
			await c.query(
				"SELECT 1 FROM foundation.analytics_preferences WHERE NOT enabled AND ((subject_kind='account' AND subject_id=$1) OR (subject_kind='organization' AND subject_id=$2))",
				[user, org],
			)
		).rowCount;
	}
	async function own<T>(
		a: TenantActor,
		org: string | null,
		work: (c: PoolClient) => Promise<T>,
		manage = false,
	) {
		if ("kind" in a || !a.assertCurrent) throw new ResourceError("DENIED");
		return withTenantTransaction(
			pool,
			org ?? "00000000-0000-4000-8000-000000000000",
			[a.userId],
			false,
			async (c) => {
				const deadline = await a.assertCurrent?.();
				if (deadline)
					await c.query(
						"SELECT set_config('app.authorization_expires_at',$1,true)",
						[deadline.toISOString()],
					);
				await options.ready(c);
				if (
					(
						await c.query(
							"SELECT lifecycle_status FROM identity.lookup_user($1)",
							[a.userId],
						)
					).rows[0]?.lifecycle_status !== "active"
				)
					throw new ResourceError("DENIED");
				if (org)
					await hooks.authorize(
						c,
						a,
						org,
						{ type: "organization", id: org },
						manage ? "manage" : "read",
					);
				await lock(c, a.userId, org);
				return work(c);
			},
			undefined,
			false,
		);
	}
	async function capture(
		c: PoolClient,
		input: {
			id: string;
			user: string;
			organization: string | null;
			event: AnalyticsEvent["event"];
			occurredAt: Date;
			feature?: AnalyticsEvent["feature"];
		},
	) {
		await lock(c, input.user, input.organization);
		if (
			!(
				await c.query(
					"INSERT INTO foundation.analytics_seen(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id",
					[input.id],
				)
			).rowCount
		)
			return;
		if (!(await permitted(c, input.user, input.organization))) return;
		if (
			(
				await c.query(
					"SELECT count(*)::int AS n FROM foundation.analytics_events WHERE state IN ('pending','inflight','ambiguous')",
				)
			).rows[0].n >= 10000
		)
			return;
		const subject = opaque(
			`subject:${input.organization ?? "personal"}:${input.user}`,
		);
		await c.query(
			"INSERT INTO foundation.analytics_subjects(id,user_id,organization_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
			[subject, input.user, input.organization],
		);
		if (
			(
				await c.query(
					"SELECT suppressed FROM foundation.analytics_subjects WHERE id=$1",
					[subject],
				)
			).rows[0].suppressed
		)
			return;
		await c.query(
			"INSERT INTO foundation.analytics_events(id,subject_id,event,feature,occurred_at,expires_at,synthetic) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '24 hours',$6) ON CONFLICT DO NOTHING",
			[
				input.id,
				subject,
				input.event,
				input.feature ?? null,
				input.occurredAt,
				options.synthetic,
			],
		);
	}
	return {
		async preferences(a: TenantActor, org: string | null) {
			return own(
				a,
				org,
				async (c) => {
					const kind = org ? "organization" : "account",
						id = org ?? a.userId;
					const row = (
						await c.query(
							"SELECT enabled,version FROM foundation.analytics_preferences WHERE subject_kind=$1 AND subject_id=$2",
							[kind, id],
						)
					).rows[0];
					return {
						enabled: row?.enabled ?? true,
						version: row?.version ?? 0,
						configured: options.enabled,
					};
				},
				Boolean(org),
			);
		},
		async setPreference(
			a: TenantActor,
			org: string | null,
			input: AnalyticsPreferenceInput,
		) {
			if (!analyticsPreferenceInput.safeParse(input).success)
				throw new ResourceError("INVALID");
			return own(
				a,
				org,
				async (c) => {
					const kind = org ? "organization" : "account",
						id = org ?? a.userId;
					const row = (
						await c.query(
							"INSERT INTO foundation.analytics_preferences(subject_kind,subject_id,enabled,version) SELECT $1,$2,$3,1 WHERE $4=0 OR EXISTS(SELECT 1 FROM foundation.analytics_preferences WHERE subject_kind=$1 AND subject_id=$2 AND version=$4) ON CONFLICT(subject_kind,subject_id) DO UPDATE SET enabled=$3,version=analytics_preferences.version+1 WHERE analytics_preferences.version=$4 RETURNING enabled,version",
							[kind, id, input.enabled, input.version],
						)
					).rows[0];
					if (!row) throw new ResourceError("CONFLICT");
					if (!input.enabled)
						await c.query(
							"UPDATE foundation.analytics_events SET state='dropped' WHERE state='pending' AND subject_id IN (SELECT id FROM foundation.analytics_subjects WHERE ($1='account' AND user_id=$2) OR ($1='organization' AND organization_id::text=$2))",
							[kind, id],
						);
					return { ...row, configured: options.enabled };
				},
				Boolean(org),
			);
		},
		async onboarding(a: TenantActor) {
			return own(a, null, async (c) => {
				const hex = createHash("sha256")
					.update(`onboarding:${a.userId}`)
					.digest("hex");
				const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
				await capture(c, {
					id,
					user: a.userId,
					organization: null,
					event: "onboarding.completed",
					occurredAt: new Date(),
				});
				return { recorded: true };
			});
		},
		/** Called after authoritative source commits; transport never accepts arbitrary business events. */
		capture,
		async deliver() {
			if (!options.enabled || !options.provider) return;
			const unresolved = (
				await pool.query(
					"SELECT e.id,s.user_id,s.organization_id FROM foundation.analytics_events e JOIN foundation.analytics_subjects s ON s.id=e.subject_id WHERE e.state IN ('inflight','ambiguous') ORDER BY e.occurred_at LIMIT 10",
				)
			).rows;
			for (const r of unresolved) {
				await withTenantTransaction(
					pool,
					r.organization_id ?? "00000000-0000-4000-8000-000000000000",
					[r.user_id],
					false,
					async (c) => {
						await options.ready(c);
						await lock(c, r.user_id, r.organization_id);
						if (await options.provider?.confirmIngested?.(r.id)) {
							await options.registry.settle(r.id);
							await c.query(
								"UPDATE foundation.analytics_events SET state='delivered' WHERE id=$1 AND state IN ('inflight','ambiguous')",
								[r.id],
							);
						}
					},
					undefined,
					false,
				);
			}

			const due = (
				await pool.query<{
					id: string;
					user_id: string;
					organization_id: string | null;
				}>(
					"SELECT e.id,s.user_id,s.organization_id FROM foundation.analytics_events e JOIN foundation.analytics_subjects s ON s.id=e.subject_id WHERE e.state='pending' AND e.available_at<=clock_timestamp() ORDER BY e.available_at,e.id LIMIT 10",
				)
			).rows;
			for (const job of due) {
				await withTenantTransaction(
					pool,
					job.organization_id ?? "00000000-0000-4000-8000-000000000000",
					[job.user_id],
					false,
					async (c) => {
						await options.ready(c);
						await lock(c, job.user_id, job.organization_id);
						const row = (
							await c.query(
								"SELECT e.*,s.suppressed FROM foundation.analytics_events e JOIN foundation.analytics_subjects s ON s.id=e.subject_id WHERE e.id=$1 AND e.state='pending'",
								[job.id],
							)
						).rows[0];
						if (!row) return;
						if (
							row.suppressed ||
							row.expires_at <= new Date() ||
							!(await permitted(c, job.user_id, job.organization_id))
						) {
							await c.query(
								"UPDATE foundation.analytics_events SET state='dropped' WHERE id=$1",
								[job.id],
							);
							return;
						}
						// Durable ambiguity survives a process crash; a separate transaction records in-flight before network IO.
						// The subject fence remains held until acknowledgement/timeout so deletion can drain this attempt.
						await options.registry.register(
							row.subject_id,
							job.user_id,
							job.organization_id,
							row.id,
						);
						await pool.query(
							"UPDATE foundation.analytics_events SET state='inflight',attempts=attempts+1 WHERE id=$1",
							[job.id],
						);
						try {
							await options.provider?.capture({
								id: row.id,
								subject: row.subject_id,
								organization: job.organization_id
									? opaque(`organization:${job.organization_id}`)
									: null,
								event: row.event,
								occurredAt: row.occurred_at.toISOString(),
								...(row.feature ? { feature: row.feature } : {}),
								synthetic: row.synthetic,
							});
							await options.registry.settle(row.id);
							await c.query(
								"UPDATE foundation.analytics_events SET state='delivered' WHERE id=$1",
								[job.id],
							);
						} catch {
							await c.query(
								"UPDATE foundation.analytics_events SET state='ambiguous' WHERE id=$1",
								[job.id],
							);
						}
					},
					undefined,
					false,
				);
			}
		},
		async suppress(kind: "account" | "organization", id: string) {
			// Registration lives outside application backups, so replay also erases subjects created after the backup.
			const registered = await options.registry.list(kind, id);
			for (const r of registered)
				await pool.query(
					"INSERT INTO foundation.analytics_subjects(id,user_id,organization_id,suppressed,deletion_state) VALUES($1,$2,$3,true,'pending') ON CONFLICT(id) DO UPDATE SET suppressed=true",
					[r.id, r.user_id, r.organization_id],
				);
			const c = await pool.connect();
			try {
				await c.query("BEGIN");
				await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
					`analytics:${kind}:${id}`,
				]);
				const rows = (
					await c.query<{
						id: string;
						receipt: AnalyticsDeletion | null;
						deletion_state: string;
					}>(
						"UPDATE foundation.analytics_subjects SET suppressed=true,deletion_state=CASE WHEN deletion_state='complete' THEN deletion_state ELSE 'pending' END WHERE ($1='account' AND user_id=$2) OR ($1='organization' AND organization_id::text=$2) RETURNING id,receipt,deletion_state",
						[kind, id],
					)
				).rows;
				await c.query(
					"UPDATE foundation.analytics_events SET state='dropped' WHERE state='pending' AND subject_id=ANY($1::text[])",
					[rows.map((r) => r.id)],
				);
				await c.query("COMMIT");
				let complete = true;
				for (const row of rows) {
					if (row.deletion_state === "complete") continue;
					let uncertain: boolean | number | null = (
						await pool.query(
							"SELECT 1 FROM foundation.analytics_events WHERE subject_id=$1 AND state IN ('inflight','ambiguous') LIMIT 1",
							[row.id],
						)
					).rowCount;
					const pending = [
						...new Set([
							...(await options.registry.unsettled(row.id)),
							...(
								await pool.query<{ id: string }>(
									"SELECT id FROM foundation.analytics_events WHERE subject_id=$1 AND state IN ('inflight','ambiguous')",
									[row.id],
								)
							).rows.map((r) => r.id),
						]),
					];
					for (const event of pending) {
						if (await options.provider?.confirmIngested?.(event)) {
							await options.registry.settle(event);
							await pool.query(
								"UPDATE foundation.analytics_events SET state='delivered' WHERE id=$1",
								[event],
							);
							row.receipt = null;
							await pool.query(
								"UPDATE foundation.analytics_subjects SET receipt=NULL WHERE id=$1",
								[row.id],
							);
						}
					}
					uncertain =
						Boolean((await options.registry.unsettled(row.id)).length) ||
						(
							await pool.query(
								"SELECT 1 FROM foundation.analytics_events WHERE subject_id=$1 AND state IN ('inflight','ambiguous') LIMIT 1",
								[row.id],
							)
						).rowCount;
					const sent =
						registered.some((r) => r.id === row.id) ||
						(
							await pool.query(
								"SELECT 1 FROM foundation.analytics_events WHERE subject_id=$1 AND state IN ('delivered','inflight','ambiguous') LIMIT 1",
								[row.id],
							)
						).rowCount;
					// Do not erase before every possibly late ingestion has settled.
					if (uncertain || (sent && !options.provider)) {
						complete = false;
						continue;
					}
					if (sent) {
						try {
							const receipt = await options.provider?.requestDeletion(
								row.id,
								row.receipt,
							);
							if (!receipt) {
								complete = false;
								continue;
							}
							await pool.query(
								"UPDATE foundation.analytics_subjects SET receipt=$2 WHERE id=$1",
								[row.id, JSON.stringify(receipt)],
							);
							if (!(await options.provider?.deletionComplete(receipt))) {
								complete = false;
								continue;
							}
						} catch {
							complete = false;
							continue;
						}
					}
					await pool.query(
						"UPDATE foundation.analytics_subjects SET deletion_state='complete' WHERE id=$1",
						[row.id],
					);
					await pool.query(
						"DELETE FROM foundation.analytics_events WHERE subject_id=$1",
						[row.id],
					);
				}
				return complete;
			} catch (e) {
				await c.query("ROLLBACK");
				throw e;
			} finally {
				c.release();
			}
		},
	};
}
