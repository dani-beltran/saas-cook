import { createHash, randomBytes, randomUUID } from "node:crypto";
import { channel } from "node:diagnostics_channel";
import type { Pool, PoolClient } from "pg";

const authorizationFenceWait = channel("common-saas.authorization.fence-wait");

export type MembershipRole = "owner" | "admin" | "member" | "billing";
export interface TenantActor {
	userId: string;
	authenticatedAt: Date;
	mfa: boolean;
	method: string;
	assertCurrent?: () => Promise<void>;
}
export interface ControlPrincipal {
	operatorId: string;
	organizationId: string;
	scope: "security:deactivate" | "owner:recover";
	expiresAt: Date;
	mfaAt: Date;
	evidenceReference: string;
}
export interface TenancyHooks {
	correlation?: () => { requestId: string; traceId?: string } | undefined;
	authorize(
		client: PoolClient,
		userId: string,
		organizationId: string,
		permission: "read" | "manage" | "transfer" | "billing",
	): Promise<void>;
	initialize(client: PoolClient, organizationId: string): Promise<void>;
	sourceCommit(client: PoolClient, organizationId: string): Promise<void>;
	notify(
		client: PoolClient,
		notification: {
			kind: "invite" | "transfer" | "transfer-completed" | "recovery";
			transfer?: { fromEmail: string; toEmail: string };
			email: string;
			organizationId: string;
			referenceId: string;
			token?: string;
			expiresAt: Date;
		},
	): Promise<void>;
}
export class TenancyError extends Error {
	constructor(
		public readonly code:
			| "DENIED"
			| "NOT_FOUND"
			| "CONFLICT"
			| "CAPACITY"
			| "EXPIRED"
			| "LAST_OWNER"
			| "INVALID",
		message = code,
	) {
		super(message);
		this.name = "TenancyError";
	}
}
interface OrganizationRow {
	id: string;
	slug: string;
	name: string;
	status: string;
	ownership_version: number;
	require_mfa: boolean;
	accept_passkey_mfa: boolean;
	required_auth_method: string | null;
}
interface MemberRow {
	id: string;
	organization_id: string;
	user_id: string;
	role: MembershipRole;
	status: "active" | "inactive";
	billable: boolean;
	expires_at: Date | null;
}
interface IdentityRow {
	id: string;
	email: string;
	email_verified: boolean;
	lifecycle_status: string;
}
interface Transition {
	userId: string;
	membershipId?: string;
	role: MembershipRole;
	status: "active" | "inactive";
	billable: boolean;
	operationKey: string;
	securityOverride?: boolean;
	ownerTransfer?: boolean;
}
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const active = (member: MemberRow) =>
	member.status === "active" &&
	(!member.expires_at || member.expires_at.getTime() > Date.now());
const fresh = (at: Date) =>
	Number.isFinite(at.getTime()) &&
	at.getTime() <= Date.now() &&
	Date.now() - at.getTime() <= 5 * 60_000;
function validateKey(key: string, allowControl = false) {
	if (!key || key.length > 128 || (!allowControl && key.startsWith("control:")))
		throw new TenancyError("INVALID");
}
function memberDto(member: MemberRow & { email: string }) {
	return {
		id: member.id,
		userId: member.user_id,
		email: member.email,
		role: member.role,
		status: member.status,
		billable: member.billable,
	};
}
function organizationDto(row: OrganizationRow) {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		status: row.status,
		ownershipVersion: row.ownership_version,
		securityPolicy: {
			requireMfa: row.require_mfa,
			acceptPasskeyMfa: row.accept_passkey_mfa,
			requiredAuthMethod: row.required_auth_method,
		},
	};
}

/** One live connection, transaction-local tenant context, canonical user -> organization lock order. */
export async function withTenantTransaction<T>(
	pool: Pool,
	organizationId: string,
	userIds: readonly string[],
	exclusive: boolean,
	work: (client: PoolClient) => Promise<T>,
	onFenceWait?: (milliseconds: number) => void,
	lockTenantRows = true,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(
			"SELECT set_config('app.request_id',$1,true),set_config('app.organization_id',$2,true),set_config('app.authorization_expires_at','',true),set_config('statement_timeout','8s',true),set_config('lock_timeout','5s',true)",
			[randomUUID(), organizationId],
		);
		for (const userId of [...new Set(userIds)].sort()) {
			await client.query(
				"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
				[`user:${userId}`],
			);
		}
		const fenceStarted = performance.now();
		await client.query(
			exclusive
				? "SELECT pg_advisory_xact_lock(hashtextextended($1,0))"
				: "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
			[`organization:${organizationId}`],
		);
		const fenceWaitMilliseconds = performance.now() - fenceStarted;
		onFenceWait?.(fenceWaitMilliseconds);
		if (authorizationFenceWait.hasSubscribers) {
			authorizationFenceWait.publish({ milliseconds: fenceWaitMilliseconds });
		}
		// Resource commands use the same organization advisory fence and lock their own rows.
		// Membership transitions also lock the organization and seat rows in the canonical order.
		if (exclusive && lockTenantRows) {
			await client.query(
				"SELECT id FROM tenancy.organizations WHERE id=$1 FOR UPDATE",
				[organizationId],
			);
			await client.query(
				"SELECT organization_id FROM tenancy.seat_capacities WHERE organization_id=$1 FOR UPDATE",
				[organizationId],
			);
		}
		const value = await work(client);
		await client.query("COMMIT");
		return value;
	} catch (error) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		client.release();
	}
}

async function identity(
	client: PoolClient,
	userId: string,
	requireActive = true,
) {
	const user = (
		await client.query<IdentityRow>(
			"SELECT id,email,email_verified,lifecycle_status FROM identity.lookup_user($1)",
			[userId],
		)
	).rows[0];
	if (
		!user ||
		(requireActive &&
			(user.lifecycle_status !== "active" || !user.email_verified))
	)
		throw new TenancyError("DENIED");
	return user;
}
async function organization(
	client: PoolClient,
	id: string,
	allowRecovery = false,
) {
	const org = (
		await client.query<OrganizationRow>(
			"SELECT * FROM tenancy.organizations WHERE id=$1",
			[id],
		)
	).rows[0];
	if (!org) throw new TenancyError("NOT_FOUND");
	if (
		org.status !== "active" &&
		!(
			allowRecovery &&
			["owner_recovery_required", "suspended"].includes(org.status)
		)
	)
		throw new TenancyError("DENIED");
	return org;
}
function policy(actor: TenantActor, org: OrganizationRow) {
	if (
		org.require_mfa &&
		(!actor.mfa || (actor.method === "passkey" && !org.accept_passkey_mfa))
	)
		throw new TenancyError("DENIED");
	if (org.required_auth_method && actor.method !== org.required_auth_method)
		throw new TenancyError("DENIED");
}
function reauthenticate(actor: TenantActor) {
	if (!fresh(actor.authenticatedAt)) throw new TenancyError("DENIED");
}
function control(
	principal: ControlPrincipal,
	organizationId: string,
	scope: ControlPrincipal["scope"],
) {
	if (
		principal.organizationId !== organizationId ||
		principal.scope !== scope ||
		!fresh(principal.mfaAt) ||
		principal.expiresAt.getTime() <= Date.now() ||
		principal.expiresAt.getTime() > Date.now() + 15 * 60_000 ||
		!principal.operatorId ||
		principal.evidenceReference.length < 8 ||
		principal.evidenceReference.length > 240
	)
		throw new TenancyError("DENIED");
}
async function appendAudit(
	client: PoolClient,
	org: string,
	actor: string,
	action: string,
	target: string,
	changes: Record<string, unknown>,
	correlation: ReturnType<NonNullable<TenancyHooks["correlation"]>>,
) {
	if (
		correlation &&
		(!/^[0-9a-f-]{36}$/i.test(correlation.requestId) ||
			(correlation.traceId && !/^[0-9a-f]{32}$/.test(correlation.traceId)))
	)
		throw new TenancyError("INVALID");
	const id = randomUUID();
	await client.query(
		"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes,request_id,trace_id) VALUES ($1,$2,$3,$4,$5,$6,coalesce($7::uuid,nullif(current_setting('app.request_id',true),'')::uuid),$8)",
		[
			id,
			org,
			actor,
			action,
			target,
			JSON.stringify(changes),
			correlation?.requestId ?? null,
			correlation?.traceId ?? null,
		],
	);
	await client.query(
		"INSERT INTO tenancy.outbox_events(id,organization_id,type,payload) VALUES ($1,$2,$3,$4)",
		[id, org, action, JSON.stringify({ targetId: target, ...changes })],
	);
}

/** Callers must derive actors from authenticated sessions, and control principals from independent operator verification. */
export function createTenancyService(
	pool: Pool,
	hooks: TenancyHooks,
	options: { defaultSeatCapacity?: number } = {},
) {
	async function audit(
		client: PoolClient,
		org: string,
		actor: string,
		action: string,
		target: string,
		changes: Record<string, unknown>,
	) {
		return appendAudit(
			client,
			org,
			actor,
			action,
			target,
			changes,
			hooks.correlation?.(),
		);
	}
	const defaultCapacity = options.defaultSeatCapacity ?? 5;
	if (!Number.isInteger(defaultCapacity) || defaultCapacity < 1)
		throw new TenancyError("INVALID");
	async function authorized(
		client: PoolClient,
		actor: TenantActor,
		orgId: string,
		permission: "read" | "manage" | "transfer" | "billing",
	) {
		await actor.assertCurrent?.();
		await identity(client, actor.userId);
		const org = await organization(client, orgId);
		policy(actor, org);
		await hooks.authorize(client, actor.userId, orgId, permission);
		return org;
	}
	async function affectedUsers(orgId: string, memberIds: string[]) {
		return withTenantTransaction(pool, orgId, [], false, async (client) => {
			const rows = await client.query<{ user_id: string }>(
				"SELECT user_id FROM tenancy.memberships WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY user_id",
				[orgId, memberIds],
			);
			if (rows.rowCount !== new Set(memberIds).size)
				throw new TenancyError("NOT_FOUND");
			return rows.rows.map((row) => row.user_id);
		});
	}
	async function transition(
		client: PoolClient,
		orgId: string,
		actorId: string,
		input: Transition,
	) {
		validateKey(input.operationKey, true);
		if (input.billable !== (input.role !== "billing"))
			throw new TenancyError("INVALID");
		const inputHash = hash(
			JSON.stringify({
				userId: input.userId,
				role: input.role,
				status: input.status,
				billable: input.billable,
			}),
		);
		const receipt = (
			await client.query<{ input_hash: string; membership_id: string }>(
				"SELECT input_hash,membership_id FROM tenancy.membership_transitions WHERE organization_id=$1 AND operation_key=$2",
				[orgId, input.operationKey],
			)
		).rows[0];
		if (receipt) {
			if (receipt.input_hash !== inputHash) throw new TenancyError("CONFLICT");
			return receipt.membership_id;
		}
		const previous = (
			await client.query<MemberRow>(
				"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE",
				[orgId, input.userId],
			)
		).rows[0];
		if (input.membershipId && previous?.id !== input.membershipId)
			throw new TenancyError("NOT_FOUND");
		if (input.status === "active") await identity(client, input.userId);
		if (
			input.role === "owner" &&
			input.status === "active" &&
			!input.ownerTransfer &&
			previous?.role !== "owner"
		)
			throw new TenancyError("DENIED");
		if (
			previous?.role === "owner" &&
			active(previous) &&
			(input.role !== "owner" || input.status !== "active") &&
			!input.securityOverride
		) {
			const owners = await client.query(
				"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND role='owner' AND status='active' AND (expires_at IS NULL OR expires_at>clock_timestamp()) AND id<>$2",
				[orgId, previous.id],
			);
			if (!owners.rowCount) throw new TenancyError("LAST_OWNER");
		}
		const oldSeat = previous?.status === "active" && previous.billable ? 1 : 0;
		const newSeat = input.status === "active" && input.billable ? 1 : 0;
		const delta = newSeat - oldSeat;
		const updated = await client.query(
			"UPDATE tenancy.seat_capacities SET occupied=occupied+$2 WHERE organization_id=$1 AND occupied+$2>=0 AND ($2<=0 OR occupied+$2<=capacity) RETURNING organization_id",
			[orgId, delta],
		);
		if (!updated.rowCount) throw new TenancyError("CAPACITY");
		const id = previous?.id ?? randomUUID();
		await client.query(
			"INSERT INTO tenancy.memberships(id,organization_id,user_id,role,status,billable) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (organization_id,user_id) DO UPDATE SET role=excluded.role,status=excluded.status,billable=excluded.billable,expires_at=NULL",
			[id, orgId, input.userId, input.role, input.status, input.billable],
		);
		await client.query(
			"INSERT INTO tenancy.membership_transitions(organization_id,operation_key,input_hash,membership_id,delta) VALUES ($1,$2,$3,$4,$5)",
			[orgId, input.operationKey, inputHash, id, delta],
		);
		if (previous?.role === "owner" || input.role === "owner")
			await client.query(
				"UPDATE tenancy.organizations SET ownership_version=ownership_version+1 WHERE id=$1",
				[orgId],
			);
		await audit(client, orgId, actorId, "membership.transition", id, {
			userId: input.userId,
			role: input.role,
			status: input.status,
			billable: input.billable,
			delta,
		});
		return id;
	}
	return {
		async createOrganization(
			actor: TenantActor,
			input: { slug: string; name: string; operationKey: string },
		) {
			validateKey(input.operationKey);
			if (
				!/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.slug) ||
				!input.name.trim() ||
				input.name.length > 120
			)
				throw new TenancyError("INVALID");
			const digest = hash(`${actor.userId}:organization:${input.operationKey}`);
			const orgId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId],
				true,
				async (client) => {
					await actor.assertCurrent?.();
					await identity(client, actor.userId);
					const existing = (
						await client.query<OrganizationRow>(
							"SELECT * FROM tenancy.organizations WHERE id=$1",
							[orgId],
						)
					).rows[0];
					if (existing) {
						if (existing.slug !== input.slug || existing.name !== input.name)
							throw new TenancyError("CONFLICT");
						await authorized(client, actor, orgId, "read");
						return organizationDto(existing);
					}
					await client.query(
						"INSERT INTO tenancy.organizations(id,slug,name) VALUES ($1,$2,$3)",
						[orgId, input.slug, input.name],
					);
					await client.query(
						"INSERT INTO tenancy.seat_capacities(organization_id,capacity) VALUES ($1,$2)",
						[orgId, defaultCapacity],
					);
					await transition(client, orgId, actor.userId, {
						userId: actor.userId,
						role: "owner",
						status: "active",
						billable: true,
						operationKey: input.operationKey,
						ownerTransfer: true,
					});
					await hooks.initialize(client, orgId);
					await hooks.authorize(client, actor.userId, orgId, "transfer");
					await audit(
						client,
						orgId,
						actor.userId,
						"organization.created",
						orgId,
						{},
					);
					return organizationDto(await organization(client, orgId));
				},
			);
		},
		async listOrganizations(actor: TenantActor) {
			const client = await pool.connect();
			let candidates: Array<{
				id: string;
				slug: string;
				name: string;
				status: string;
				role: MembershipRole;
			}>;
			try {
				await client.query("BEGIN");
				await client.query(
					"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
					[`user:${actor.userId}`],
				);
				await actor.assertCurrent?.();
				await identity(client, actor.userId);
				candidates = (
					await client.query<{
						id: string;
						slug: string;
						name: string;
						status: string;
						role: MembershipRole;
					}>("SELECT * FROM tenancy.organizations_for_user($1) LIMIT 101", [
						actor.userId,
					])
				).rows;
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK").catch(() => undefined);
				throw error;
			} finally {
				client.release();
			}
			if (candidates.length > 100) throw new TenancyError("INVALID");
			const visible: typeof candidates = [];
			for (const candidate of candidates) {
				try {
					await withTenantTransaction(
						pool,
						candidate.id,
						[actor.userId],
						false,
						async (connection) => {
							await authorized(connection, actor, candidate.id, "read");
						},
					);
					visible.push(candidate);
				} catch (error) {
					if (
						(error instanceof TenancyError && error.code === "DENIED") ||
						(error instanceof Error && error.message === "Authorization denied")
					)
						continue;
					throw error;
				}
			}
			return visible;
		},
		async readSummary(actor: TenantActor, organizationId: string) {
			return withTenantTransaction(
				pool,
				organizationId,
				[actor.userId],
				false,
				async (client) => {
					const org = await authorized(client, actor, organizationId, "read");
					const own = (
						await client.query<MemberRow & { email: string }>(
							"SELECT m.*,u.email FROM tenancy.memberships m CROSS JOIN LATERAL identity.lookup_user(m.user_id) u WHERE m.organization_id=$1 AND m.user_id=$2",
							[organizationId, actor.userId],
						)
					).rows[0];
					if (!own) throw new TenancyError("DENIED");
					return {
						organization: organizationDto(org),
						membership: memberDto(own),
					};
				},
			);
		},
		async readOrganization(actor: TenantActor, organizationId: string) {
			return withTenantTransaction(
				pool,
				organizationId,
				[actor.userId],
				false,
				async (client) => {
					const org = await authorized(client, actor, organizationId, "manage");
					const members = (
						await client.query<MemberRow & { email: string }>(
							"SELECT m.*,u.email FROM tenancy.memberships m CROSS JOIN LATERAL identity.lookup_user(m.user_id) u WHERE m.organization_id=$1 ORDER BY m.id LIMIT 501",
							[organizationId],
						)
					).rows;
					if (members.length > 500) throw new TenancyError("INVALID");
					const own = members.find((member) => member.user_id === actor.userId);
					if (!own) throw new TenancyError("DENIED");
					return {
						organization: organizationDto(org),
						membership: memberDto(own),
						members: members.map(memberDto),
						invitations: (
							await client.query<{
								id: string;
								email: string;
								role: string;
								status: string;
								expiresAt: Date;
							}>(
								'SELECT id,email,role,status,expires_at AS "expiresAt" FROM tenancy.invitations WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',
								[organizationId],
							)
						).rows,
						teams: (
							await client.query<{
								id: string;
								name: string;
								membershipIds: string[];
							}>(
								'SELECT t.id,t.name,ARRAY(SELECT tm.membership_id FROM tenancy.team_members tm WHERE tm.organization_id=t.organization_id AND tm.team_id=t.id ORDER BY tm.membership_id) AS "membershipIds" FROM tenancy.teams t WHERE t.organization_id=$1 ORDER BY t.name,t.id LIMIT 100',
								[organizationId],
							)
						).rows,
						transfers: (
							await client.query<{
								id: string;
								fromMembershipId: string;
								toMembershipId: string;
								outgoingRole: "admin" | "member" | "billing" | "inactive";
								status: string;
								expiresAt: Date;
							}>(
								'SELECT id,initiator_membership_id AS "fromMembershipId",recipient_membership_id AS "toMembershipId",outgoing_role AS "outgoingRole",status,expires_at AS "expiresAt" FROM tenancy.ownership_transfers WHERE organization_id=$1 ORDER BY expires_at DESC LIMIT 100',
								[organizationId],
							)
						).rows,
						seats: (
							await client.query<{ capacity: number; occupied: number }>(
								"SELECT capacity,occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
								[organizationId],
							)
						).rows[0] ?? { capacity: 0, occupied: 0 },
					};
				},
			);
		},
		async invite(
			actor: TenantActor,
			orgId: string,
			input: {
				email: string;
				role: Exclude<MembershipRole, "owner">;
				operationKey: string;
			},
		) {
			validateKey(input.operationKey);
			const email = input.email.trim().toLowerCase();
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
				throw new TenancyError("INVALID");
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId],
				true,
				async (client) => {
					await authorized(client, actor, orgId, "manage");
					const inviter = (
						await client.query<MemberRow>(
							"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2",
							[orgId, actor.userId],
						)
					).rows[0];
					if (!inviter) throw new TenancyError("DENIED");
					const prior = (
						await client.query<{
							id: string;
							email: string;
							role: string;
							expiresAt: Date;
						}>(
							'SELECT id,email,role,expires_at AS "expiresAt" FROM tenancy.invitations WHERE organization_id=$1 AND operation_key=$2',
							[orgId, input.operationKey],
						)
					).rows[0];
					if (prior) {
						if (prior.email !== email || prior.role !== input.role)
							throw new TenancyError("CONFLICT");
						return { id: prior.id, expiresAt: prior.expiresAt };
					}
					const id = randomUUID(),
						token = randomBytes(32).toString("base64url"),
						expiresAt = new Date(Date.now() + 7 * 86_400_000);
					await client.query(
						"INSERT INTO tenancy.invitations(id,organization_id,email,token_hash,role,inviter_membership_id,expires_at,operation_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
						[
							id,
							orgId,
							email,
							hash(token),
							input.role,
							inviter.id,
							expiresAt,
							input.operationKey,
						],
					);
					await audit(client, orgId, actor.userId, "invitation.created", id, {
						role: input.role,
					});
					await hooks.notify(client, {
						kind: "invite",
						email,
						organizationId: orgId,
						referenceId: id,
						token,
						expiresAt,
					});
					return { id, expiresAt };
				},
			);
		},
		async acceptInvitation(
			actor: TenantActor,
			orgId: string,
			input: { token: string; operationKey: string },
		) {
			validateKey(input.operationKey);
			const inviterUsers = await withTenantTransaction(
				pool,
				orgId,
				[],
				false,
				async (client) =>
					(
						await client.query<{ user_id: string }>(
							"SELECT m.user_id FROM tenancy.invitations i JOIN tenancy.memberships m ON m.organization_id=i.organization_id AND m.id=i.inviter_membership_id WHERE i.organization_id=$1 AND i.token_hash=$2",
							[orgId, hash(input.token)],
						)
					).rows.map((row) => row.user_id),
			);
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId, ...inviterUsers],
				true,
				async (client) => {
					await actor.assertCurrent?.();
					const user = await identity(client, actor.userId),
						org = await organization(client, orgId);
					policy(actor, org);
					const invite = (
						await client.query<{
							id: string;
							email: string;
							role: MembershipRole;
							status: string;
							expires_at: Date;
							accepted_by: string | null;
							inviter_membership_id: string;
						}>(
							"SELECT * FROM tenancy.invitations WHERE organization_id=$1 AND token_hash=$2 FOR UPDATE",
							[orgId, hash(input.token)],
						)
					).rows[0];
					if (!invite || invite.email !== user.email.toLowerCase())
						throw new TenancyError("DENIED");
					if (
						invite.status === "accepted" &&
						invite.accepted_by === actor.userId
					)
						return { id: invite.id };
					if (
						invite.status !== "pending" ||
						invite.expires_at.getTime() <= Date.now()
					)
						throw new TenancyError("EXPIRED");
					const inviter = (
						await client.query<MemberRow>(
							"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND id=$2",
							[orgId, invite.inviter_membership_id],
						)
					).rows[0];
					if (
						!inviter ||
						!active(inviter) ||
						!inviterUsers.includes(inviter.user_id)
					)
						throw new TenancyError("DENIED");
					await identity(client, inviter.user_id);
					await hooks.authorize(client, inviter.user_id, orgId, "manage");
					const old = (
						await client.query<MemberRow>(
							"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2",
							[orgId, actor.userId],
						)
					).rows[0];
					if (old && active(old)) throw new TenancyError("CONFLICT");
					await transition(client, orgId, actor.userId, {
						userId: actor.userId,
						role: invite.role,
						status: "active",
						billable: invite.role !== "billing",
						operationKey: input.operationKey,
					});
					await client.query(
						"UPDATE tenancy.invitations SET status='accepted',accepted_by=$3 WHERE organization_id=$1 AND id=$2",
						[orgId, invite.id, actor.userId],
					);
					await hooks.sourceCommit(client, orgId);
					await audit(
						client,
						orgId,
						actor.userId,
						"invitation.accepted",
						invite.id,
						{},
					);
					return { id: invite.id };
				},
			);
		},
		async cancelInvitation(actor: TenantActor, orgId: string, id: string) {
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId],
				true,
				async (client) => {
					await authorized(client, actor, orgId, "manage");
					const result = await client.query(
						"UPDATE tenancy.invitations SET status='canceled' WHERE organization_id=$1 AND id=$2 AND status='pending' RETURNING id",
						[orgId, id],
					);
					if (!result.rowCount) throw new TenancyError("CONFLICT");
					await audit(
						client,
						orgId,
						actor.userId,
						"invitation.canceled",
						id,
						{},
					);
				},
			);
		},
		async transitionMembership(
			actor: TenantActor,
			orgId: string,
			input: {
				membershipId: string;
				status: "active" | "inactive";
				role: MembershipRole;
				billable: boolean;
				operationKey: string;
			},
		) {
			validateKey(input.operationKey);
			const users = await affectedUsers(orgId, [input.membershipId]);
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId, ...users],
				true,
				async (client) => {
					await authorized(client, actor, orgId, "manage");
					const userId = users[0];
					if (!userId) throw new TenancyError("NOT_FOUND");
					const id = await transition(client, orgId, actor.userId, {
						...input,
						userId,
					});
					await hooks.sourceCommit(client, orgId);
					return { id };
				},
			);
		},
		async createTeam(
			actor: TenantActor,
			orgId: string,
			input: { name: string; slug: string },
		) {
			if (
				!input.name.trim() ||
				input.name.length > 120 ||
				!/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.slug)
			)
				throw new TenancyError("INVALID");
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId],
				true,
				async (client) => {
					await authorized(client, actor, orgId, "manage");
					const prior = (
						await client.query<{ id: string; name: string }>(
							"SELECT id,name FROM tenancy.teams WHERE organization_id=$1 AND slug=$2",
							[orgId, input.slug],
						)
					).rows[0];
					if (prior) {
						if (prior.name !== input.name) throw new TenancyError("CONFLICT");
						return { id: prior.id };
					}
					const id = randomUUID();
					await client.query(
						"INSERT INTO tenancy.teams(id,organization_id,name,slug) VALUES ($1,$2,$3,$4)",
						[id, orgId, input.name, input.slug],
					);
					await hooks.sourceCommit(client, orgId);
					await audit(client, orgId, actor.userId, "team.created", id, {});
					return { id };
				},
			);
		},

		async removeTeam(actor: TenantActor, orgId: string, teamId: string) {
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId],
				true,
				async (client) => {
					await authorized(client, actor, orgId, "manage");
					await client.query(
						"DELETE FROM tenancy.team_members WHERE organization_id=$1 AND team_id=$2",
						[orgId, teamId],
					);
					const result = await client.query(
						"DELETE FROM tenancy.teams WHERE organization_id=$1 AND id=$2 RETURNING id",
						[orgId, teamId],
					);
					if (!result.rowCount) throw new TenancyError("NOT_FOUND");
					await hooks.sourceCommit(client, orgId);
					await audit(client, orgId, actor.userId, "team.removed", teamId, {});
				},
			);
		},
		async setTeamMember(
			actor: TenantActor,
			orgId: string,
			input: { teamId: string; membershipId: string; present: boolean },
		) {
			const users = await affectedUsers(orgId, [input.membershipId]);
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId, ...users],
				true,
				async (client) => {
					await authorized(client, actor, orgId, "manage");
					const member = (
						await client.query<MemberRow>(
							"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND id=$2",
							[orgId, input.membershipId],
						)
					).rows[0];
					if (!member || (input.present && !active(member)))
						throw new TenancyError("DENIED");
					if (input.present) {
						await identity(client, member.user_id);
						await client.query(
							"INSERT INTO tenancy.team_members(organization_id,team_id,membership_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
							[orgId, input.teamId, input.membershipId],
						);
					} else
						await client.query(
							"DELETE FROM tenancy.team_members WHERE organization_id=$1 AND team_id=$2 AND membership_id=$3",
							[orgId, input.teamId, input.membershipId],
						);
					await hooks.sourceCommit(client, orgId);
					await audit(
						client,
						orgId,
						actor.userId,
						"team.member_changed",
						input.teamId,
						{ membershipId: input.membershipId, present: input.present },
					);
				},
			);
		},
		async startTransfer(
			actor: TenantActor,
			orgId: string,
			input: {
				recipientMembershipId: string;
				outgoingRole: "admin" | "member" | "billing" | "inactive";
			},
		) {
			reauthenticate(actor);
			const users = await affectedUsers(orgId, [input.recipientMembershipId]);
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId, ...users],
				true,
				async (client) => {
					const org = await authorized(client, actor, orgId, "transfer");
					reauthenticate(actor);
					const rows = (
						await client.query<MemberRow>(
							"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND (user_id=$2 OR id=$3) ORDER BY id FOR UPDATE",
							[orgId, actor.userId, input.recipientMembershipId],
						)
					).rows;
					const sender = rows.find((row) => row.user_id === actor.userId),
						recipient = rows.find(
							(row) => row.id === input.recipientMembershipId,
						);
					if (
						sender?.role !== "owner" ||
						!active(sender) ||
						!recipient ||
						!active(recipient) ||
						sender.id === recipient.id
					)
						throw new TenancyError("DENIED");
					const user = await identity(client, recipient.user_id);
					const fromUser = await identity(client, sender.user_id);
					await client.query(
						"UPDATE tenancy.ownership_transfers SET status='expired' WHERE organization_id=$1 AND initiator_membership_id=$2 AND status='pending' AND expires_at<=clock_timestamp()",
						[orgId, sender.id],
					);
					const id = randomUUID(),
						expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
					await client.query(
						"INSERT INTO tenancy.ownership_transfers(id,organization_id,initiator_membership_id,recipient_membership_id,ownership_version,outgoing_role,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
						[
							id,
							orgId,
							sender.id,
							recipient.id,
							org.ownership_version,
							input.outgoingRole,
							expiresAt,
						],
					);
					await audit(
						client,
						orgId,
						actor.userId,
						"ownership.transfer_requested",
						id,
						{ fromMembershipId: sender.id, toMembershipId: recipient.id },
					);
					await hooks.notify(client, {
						kind: "transfer",
						transfer: { fromEmail: fromUser.email, toEmail: user.email },
						email: user.email,
						organizationId: orgId,
						referenceId: id,
						expiresAt,
					});
					return { id, expiresAt };
				},
			);
		},
		async acceptTransfer(
			actor: TenantActor,
			orgId: string,
			input: { transferId: string; operationKey: string },
		) {
			validateKey(input.operationKey);
			reauthenticate(actor);
			const ids = await withTenantTransaction(
				pool,
				orgId,
				[],
				false,
				async (client) =>
					(
						await client.query<{
							initiator_membership_id: string;
							recipient_membership_id: string;
						}>(
							"SELECT initiator_membership_id,recipient_membership_id FROM tenancy.ownership_transfers WHERE organization_id=$1 AND id=$2",
							[orgId, input.transferId],
						)
					).rows[0],
			);
			if (!ids) throw new TenancyError("NOT_FOUND");
			const users = await affectedUsers(orgId, [
				ids.initiator_membership_id,
				ids.recipient_membership_id,
			]);
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId, ...users],
				true,
				async (client) => {
					const org = await authorized(client, actor, orgId, "read");
					reauthenticate(actor);
					const transfer = (
						await client.query<{
							status: string;
							expires_at: Date;
							ownership_version: number;
							outgoing_role: "admin" | "member" | "billing" | "inactive";
						}>(
							"SELECT status,expires_at,ownership_version,outgoing_role FROM tenancy.ownership_transfers WHERE organization_id=$1 AND id=$2 FOR UPDATE",
							[orgId, input.transferId],
						)
					).rows[0];
					const rows = (
						await client.query<MemberRow>(
							"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
							[
								orgId,
								[ids.initiator_membership_id, ids.recipient_membership_id],
							],
						)
					).rows;
					const sender = rows.find(
							(row) => row.id === ids.initiator_membership_id,
						),
						recipient = rows.find(
							(row) => row.id === ids.recipient_membership_id,
						);
					if (
						!transfer ||
						!sender ||
						!recipient ||
						recipient.user_id !== actor.userId ||
						!active(recipient)
					)
						throw new TenancyError("DENIED");
					if (transfer.status === "accepted") return { id: input.transferId };
					if (!active(sender) || sender.role !== "owner")
						throw new TenancyError("DENIED");
					const fromUser = await identity(client, sender.user_id);
					const toUser = await identity(client, recipient.user_id);
					if (
						transfer.status !== "pending" ||
						transfer.expires_at.getTime() <= Date.now()
					)
						throw new TenancyError("EXPIRED");
					if (transfer.ownership_version !== org.ownership_version)
						throw new TenancyError("CONFLICT");
					await hooks.authorize(client, sender.user_id, orgId, "transfer");
					// Release first when required, then promote, under one exclusive fence. Temporary ownerlessness is unobservable.
					await transition(client, orgId, actor.userId, {
						userId: sender.user_id,
						role:
							transfer.outgoing_role === "inactive"
								? "member"
								: transfer.outgoing_role,
						status:
							transfer.outgoing_role === "inactive" ? "inactive" : "active",
						billable: transfer.outgoing_role !== "billing",
						operationKey: `${input.operationKey}:out`,
						securityOverride: true,
					});
					await transition(client, orgId, actor.userId, {
						userId: recipient.user_id,
						role: "owner",
						status: "active",
						billable: true,
						operationKey: `${input.operationKey}:in`,
						ownerTransfer: true,
					});
					await client.query(
						"UPDATE tenancy.ownership_transfers SET status='accepted',accepted_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
						[orgId, input.transferId],
					);
					await hooks.sourceCommit(client, orgId);
					await hooks.authorize(client, recipient.user_id, orgId, "transfer");
					await audit(
						client,
						orgId,
						actor.userId,
						"ownership.transferred",
						input.transferId,
						{ fromMembershipId: sender.id, toMembershipId: recipient.id },
					);
					for (const email of [fromUser.email, toUser.email])
						await hooks.notify(client, {
							kind: "transfer-completed",
							email,
							organizationId: orgId,
							referenceId: input.transferId,
							transfer: { fromEmail: fromUser.email, toEmail: toUser.email },
							expiresAt: new Date(Date.now() + 7 * 86_400_000),
						});
					return { id: input.transferId };
				},
			);
		},
		async cancelTransfer(
			actor: TenantActor,
			orgId: string,
			transferId: string,
		) {
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId],
				true,
				async (client) => {
					await authorized(client, actor, orgId, "transfer");
					const result = await client.query(
						"UPDATE tenancy.ownership_transfers t SET status='canceled' FROM tenancy.memberships m WHERE t.organization_id=$1 AND t.id=$2 AND t.status='pending' AND m.organization_id=t.organization_id AND m.id=t.initiator_membership_id AND m.user_id=$3 RETURNING t.id",
						[orgId, transferId, actor.userId],
					);
					if (!result.rowCount) throw new TenancyError("CONFLICT");
					await audit(
						client,
						orgId,
						actor.userId,
						"ownership.transfer_canceled",
						transferId,
						{},
					);
				},
			);
		},
		async securityDeactivate(
			principal: ControlPrincipal,
			orgId: string,
			input: { membershipId: string; operationKey: string },
		) {
			control(principal, orgId, "security:deactivate");
			const users = await affectedUsers(orgId, [input.membershipId]);
			return withTenantTransaction(pool, orgId, users, true, async (client) => {
				control(principal, orgId, "security:deactivate");
				await organization(client, orgId, true);
				const member = (
					await client.query<MemberRow>(
						"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND id=$2 FOR UPDATE",
						[orgId, input.membershipId],
					)
				).rows[0];
				if (!member) throw new TenancyError("NOT_FOUND");
				await transition(client, orgId, principal.operatorId, {
					userId: member.user_id,

					membershipId: member.id,
					role: member.role,
					status: "inactive",
					billable: member.billable,
					operationKey: input.operationKey,
					securityOverride: true,
				});
				await client.query(
					"UPDATE tenancy.ownership_transfers SET status='canceled' WHERE organization_id=$1 AND status='pending' AND (initiator_membership_id=$2 OR recipient_membership_id=$2)",
					[orgId, member.id],
				);
				const owners = await client.query(
					"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND role='owner' AND status='active' AND (expires_at IS NULL OR expires_at>clock_timestamp())",
					[orgId],
				);
				if (!owners.rowCount)
					await client.query(
						"UPDATE tenancy.organizations SET status='owner_recovery_required' WHERE id=$1",
						[orgId],
					);
				await hooks.sourceCommit(client, orgId);
				await audit(
					client,
					orgId,
					principal.operatorId,
					"security.member_deactivated",
					member.id,
					{
						evidenceReference: principal.evidenceReference,
						ownerRecoveryRequired: !owners.rowCount,
					},
				);
				return { ownerRecoveryRequired: !owners.rowCount };
			});
		},
		async recoverOwner(
			principal: ControlPrincipal,
			orgId: string,
			input: { replacement: TenantActor; operationKey: string },
		) {
			control(principal, orgId, "owner:recover");
			reauthenticate(input.replacement);
			if (!input.replacement.mfa) throw new TenancyError("DENIED");
			return withTenantTransaction(
				pool,
				orgId,
				[input.replacement.userId],
				true,
				async (client) => {
					control(principal, orgId, "owner:recover");
					reauthenticate(input.replacement);
					await input.replacement.assertCurrent?.();
					const org = await organization(client, orgId, true);
					if (org.status !== "owner_recovery_required")
						throw new TenancyError("CONFLICT");
					policy(input.replacement, org);
					const user = await identity(client, input.replacement.userId);
					const prior = (
						await client.query<MemberRow>(
							"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE",
							[orgId, user.id],
						)
					).rows[0];
					// A security-deactivated owner can never be automatically restored by recovery.
					if (prior?.role === "owner" && prior.status === "inactive")
						throw new TenancyError("DENIED");
					await transition(client, orgId, principal.operatorId, {
						userId: user.id,
						role: "owner",
						status: "active",
						billable: true,
						operationKey: input.operationKey,
						ownerTransfer: true,
					});
					await hooks.sourceCommit(client, orgId);
					// Contextual publication is the source commit. Require the live policy decision before reopening.
					await client.query(
						"UPDATE tenancy.organizations SET status='active' WHERE id=$1",
						[orgId],
					);
					await hooks.authorize(client, user.id, orgId, "transfer");
					const id = randomUUID();
					await client.query(
						"INSERT INTO tenancy.owner_recovery_cases(id,organization_id,operator_id,evidence_reference,replacement_user_id,outcome) VALUES ($1,$2,$3,$4,$5,'completed')",
						[
							id,
							orgId,
							principal.operatorId,
							principal.evidenceReference,
							user.id,
						],
					);
					await audit(
						client,
						orgId,
						principal.operatorId,
						"ownership.recovered",
						id,
						{
							replacementUserId: user.id,
							evidenceReference: principal.evidenceReference,
						},
					);
					await hooks.notify(client, {
						kind: "recovery",
						email: user.email,
						organizationId: orgId,
						referenceId: id,
						expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
					});
					return { id };
				},
			);
		},
		async setSecurityPolicy(
			actor: TenantActor,
			orgId: string,
			input: {
				requireMfa: boolean;
				acceptPasskeyMfa: boolean;
				requiredAuthMethod: null | "passkey";
			},
		) {
			reauthenticate(actor);
			if (
				!actor.mfa ||
				(input.requiredAuthMethod !== null &&
					input.requiredAuthMethod !== "passkey")
			)
				throw new TenancyError("DENIED");
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId],
				true,
				async (client) => {
					const org = await authorized(client, actor, orgId, "transfer");
					reauthenticate(actor);
					policy(actor, {
						...org,
						require_mfa: input.requireMfa,
						accept_passkey_mfa: input.acceptPasskeyMfa,
						required_auth_method: input.requiredAuthMethod,
					});
					await client.query(
						"UPDATE tenancy.organizations SET require_mfa=$2,accept_passkey_mfa=$3,required_auth_method=$4 WHERE id=$1",
						[
							orgId,
							input.requireMfa,
							input.acceptPasskeyMfa,
							input.requiredAuthMethod,
						],
					);
					await hooks.sourceCommit(client, orgId);
					await audit(
						client,
						orgId,
						actor.userId,
						"security.policy_changed",
						orgId,
						input,
					);
				},
			);
		},
		async setLocalCapacity(
			actor: TenantActor,
			orgId: string,
			capacity: number,
		) {
			if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100_000)
				throw new TenancyError("INVALID");
			return withTenantTransaction(
				pool,
				orgId,
				[actor.userId],
				true,
				async (client) => {
					await authorized(client, actor, orgId, "billing");
					reauthenticate(actor);
					const result = await client.query(
						"UPDATE tenancy.seat_capacities SET capacity=$2,policy_version=policy_version+1 WHERE organization_id=$1 AND occupied<=$2 RETURNING organization_id",
						[orgId, capacity],
					);
					if (!result.rowCount) throw new TenancyError("CAPACITY");
					await audit(
						client,
						orgId,
						actor.userId,
						"seats.capacity_changed",
						orgId,
						{ capacity },
					);
				},
			);
		},
	};
}
