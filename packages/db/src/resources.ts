import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { assertLimit, commercialFeatures } from "./billing/policy";
import { reserveProjectUsage, settleProjectUsage } from "./billing/usage";
import {
	assertAuthorizationCurrent,
	type TenantActor,
	withTenantTransaction,
} from "./tenancy";
export type ResourceActor =
	| TenantActor
	| {
			kind: "service";
			organizationId: string;
			serviceAccountId: string;
			apiKeyId: string;
			scopes: readonly string[];
			token: string;
			assertCurrent?: () => Promise<Date | undefined> | Promise<void>;
	  };
export type ResourcePermission =
	| "read"
	| "create"
	| "update"
	| "delete"
	| "restore"
	| "manage"
	| "share";
export type ResourceTarget = {
	type: "organization" | "project";
	id: string;
	resourceType?: "project";
};
/** Authorization implementations must revalidate the actor, organization policy and
 * independent readiness on this exact lock-bearing connection before any allow. */
export interface ResourceHooks {
	authorize(
		client: PoolClient,
		actor: ResourceActor,
		organizationId: string,
		target: ResourceTarget,
		permission: ResourcePermission,
	): Promise<void>;
	check(
		client: PoolClient,
		actor: ResourceActor,
		organizationId: string,
		target: ResourceTarget,
		permission: ResourcePermission,
	): Promise<boolean>;
	checkBatch?(
		client: PoolClient,
		actor: ResourceActor,
		organizationId: string,
		checks: ReadonlyArray<{
			target: ResourceTarget;
			permission: ResourcePermission;
		}>,
	): Promise<boolean[]>;
	sourceCommit(client: PoolClient, organizationId: string): Promise<void>;
	correlation?: () => { requestId: string; traceId?: string } | undefined;
}
export class ResourceError extends Error {
	constructor(
		public readonly code:
			| "DENIED"
			| "NOT_FOUND"
			| "CONFLICT"
			| "CAPACITY"
			| "INVALID"
			| "DISABLED"
			| "EXPIRED",
		message: string = code,
	) {
		super(message);
		this.name = "ResourceError";
	}
}
export type ProjectStatus = "active" | "completed" | "archived";
interface ProjectRow {
	id: string;
	organization_id: string;
	name: string;
	slug: string;
	description: string;
	status: ProjectStatus;
	owner_membership_id: string | null;
	version: number;
	created_at: Date;
	updated_at: Date;
	deleted_at: Date | null;
}
const projectDto = (r: ProjectRow) => ({
	id: r.id,
	organizationId: r.organization_id,
	name: r.name,
	slug: r.slug,
	description: r.description,
	status: r.status,
	ownerMembershipId: r.owner_membership_id,
	version: r.version,
	createdAt: r.created_at.toISOString(),
	updatedAt: r.updated_at.toISOString(),
	deletedAt: r.deleted_at?.toISOString() ?? null,
});
const actorId = (a: ResourceActor) =>
	"userId" in a ? `user:${a.userId}` : `service:${a.serviceAccountId}`;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const cursorFallback = randomBytes(32);
function validId(id: string) {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
	)
		throw new ResourceError("INVALID");
}
function validText(value: string, min: number, max: number) {
	if (
		typeof value !== "string" ||
		value.trim().length < min ||
		value.length > max
	)
		throw new ResourceError("INVALID");
}
function validFields(input: object, allowed: readonly string[]) {
	if (Object.keys(input).some((key) => !allowed.includes(key)))
		throw new ResourceError("INVALID");
}
function validKey(key: string) {
	validText(key, 1, 128);
}
function validVersion(version: number) {
	if (!Number.isSafeInteger(version) || version < 1)
		throw new ResourceError("INVALID");
}
function validNameSlug(name: string, slug: string) {
	validText(name, 1, 120);
	if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))
		throw new ResourceError("INVALID");
}
export type CapacityPolicy =
	| { kind: "missing" | "disabled" | "unlimited" }
	| { kind: "limited"; limit: number };
interface Bucket {
	id: string;
	policy_kind: CapacityPolicy["kind"];
	capacity: number | null;
	consumed: number;
	reserved: number;
	policy_version: number;
}
/** These helpers require an already authorized transaction holding the organization fence. No pool or unscoped SQL is accepted. */
export async function expireCapacityReservations(
	client: PoolClient,
	organizationId: string,
	bucketId: string,
) {
	await client.query(
		"SELECT id FROM tenancy.capacity_buckets WHERE organization_id=$1 AND id=$2 FOR UPDATE",
		[organizationId, bucketId],
	);
	const expired = await client.query<{ quantity: number }>(
		"UPDATE tenancy.capacity_reservations SET state='expired' WHERE organization_id=$1 AND bucket_id=$2 AND state='reserved' AND expires_at<=clock_timestamp() RETURNING quantity",
		[organizationId, bucketId],
	);
	const quantity = expired.rows.reduce((n, r) => n + r.quantity, 0);
	if (quantity)
		await client.query(
			"UPDATE tenancy.capacity_buckets SET reserved=reserved-$3 WHERE organization_id=$1 AND id=$2",
			[organizationId, bucketId, quantity],
		);
}
export async function reserveCapacity(
	client: PoolClient,
	organizationId: string,
	feature: string,
	operationKey: string,
	quantity: number,
	expiresAt: Date,
) {
	validKey(operationKey);
	if (
		!Number.isSafeInteger(quantity) ||
		quantity <= 0 ||
		!Number.isFinite(expiresAt.getTime()) ||
		expiresAt.getTime() <= Date.now() ||
		expiresAt.getTime() > Date.now() + 86400000
	)
		throw new ResourceError("INVALID");
	const bucket = (
		await client.query<Bucket>(
			"SELECT * FROM tenancy.capacity_buckets WHERE organization_id=$1 AND feature=$2 FOR UPDATE",
			[organizationId, feature],
		)
	).rows[0];
	if (
		!bucket ||
		bucket.policy_kind === "missing" ||
		bucket.policy_kind === "disabled"
	)
		throw new ResourceError("DISABLED");
	await expireCapacityReservations(client, organizationId, bucket.id);
	const previous = (
		await client.query<{ id: string; quantity: number; state: string }>(
			"SELECT id,quantity,state FROM tenancy.capacity_reservations WHERE organization_id=$1 AND bucket_id=$2 AND operation_key=$3",
			[organizationId, bucket.id, operationKey],
		)
	).rows[0];
	if (previous) {
		if (previous.quantity !== quantity) throw new ResourceError("CONFLICT");
		if (previous.state === "expired" || previous.state === "released")
			throw new ResourceError("EXPIRED");
		return previous.id;
	}
	const admitted = await client.query(
		"UPDATE tenancy.capacity_buckets SET reserved=reserved+$3 WHERE organization_id=$1 AND id=$2 AND (policy_kind='unlimited' OR (policy_kind='limited' AND consumed+reserved+$3<=capacity))",
		[organizationId, bucket.id, quantity],
	);
	if (admitted.rowCount !== 1) throw new ResourceError("CAPACITY");
	const id = randomUUID();
	await client.query(
		"INSERT INTO tenancy.capacity_reservations(id,organization_id,bucket_id,operation_key,quantity,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
		[id, organizationId, bucket.id, operationKey, quantity, expiresAt],
	);
	return id;
}
export async function settleCapacityReservation(
	client: PoolClient,
	organizationId: string,
	reservationId: string,
	state: "committed" | "released",
) {
	// Lock bucket before reservation on every path, matching reserve/expiry.
	const found = (
		await client.query<{ bucket_id: string }>(
			"SELECT bucket_id FROM tenancy.capacity_reservations WHERE organization_id=$1 AND id=$2",
			[organizationId, reservationId],
		)
	).rows[0];
	if (!found) throw new ResourceError("NOT_FOUND");
	await client.query(
		"SELECT id FROM tenancy.capacity_buckets WHERE organization_id=$1 AND id=$2 FOR UPDATE",
		[organizationId, found.bucket_id],
	);
	const row = (
		await client.query<{ quantity: number; state: string; valid: boolean }>(
			"SELECT quantity,state,expires_at>clock_timestamp() AS valid FROM tenancy.capacity_reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE",
			[organizationId, reservationId],
		)
	).rows[0];
	if (!row) throw new ResourceError("NOT_FOUND");
	if (row.state === state) return;
	if (row.state !== "reserved") throw new ResourceError("CONFLICT");
	if (state === "committed" && !row.valid) throw new ResourceError("EXPIRED");
	await client.query(
		"UPDATE tenancy.capacity_buckets SET reserved=reserved-$3,consumed=consumed+$4 WHERE organization_id=$1 AND id=$2",
		[
			organizationId,
			found.bucket_id,
			row.quantity,
			state === "committed" ? row.quantity : 0,
		],
	);
	await client.query(
		"UPDATE tenancy.capacity_reservations SET state=$3 WHERE organization_id=$1 AND id=$2",
		[organizationId, reservationId, state],
	);
}
export function createResourceService(
	pool: Pool,
	hooks: ResourceHooks,
	options: {
		defaultProjectCapacity?: number | null;
		defaultProjectCreatesPerMonth?: number | null;
		usageThresholds?: readonly number[];
		cursorSecret?: string;
		onFenceWait?: (milliseconds: number) => void;
	} = {},
) {
	const defaultCapacity =
		options.defaultProjectCapacity === undefined
			? 100
			: options.defaultProjectCapacity;
	if (
		defaultCapacity !== null &&
		(!Number.isSafeInteger(defaultCapacity) || defaultCapacity < 0)
	)
		throw new ResourceError("INVALID");
	const cursorKey = options.cursorSecret
		? createHash("sha256").update(options.cursorSecret).digest()
		: cursorFallback;
	function transaction<T>(
		actor: ResourceActor,
		org: string,
		exclusive: boolean,
		work: (c: PoolClient) => Promise<T>,
		affectedUsers: string[] = [],
	) {
		validId(org);
		return withTenantTransaction(
			pool,
			org,
			"userId" in actor ? [actor.userId, ...affectedUsers] : affectedUsers,
			exclusive,
			async (client) => {
				// The mandatory authorization hook validates session/key, membership,
				// organization policy and independent readiness under these same fences.
				if (!("userId" in actor) && actor.organizationId !== org)
					throw new ResourceError("DENIED");
				const value = await work(client);
				// Earlier allows must remain live through later FGA calls and all domain work.
				await assertAuthorizationCurrent(client);
				return value;
			},
			options.onFenceWait,
			false,
		).catch((error: unknown) => {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "23505"
			)
				throw new ResourceError("CONFLICT");
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				(error.code === "23503" || error.code === "23514")
			)
				throw new ResourceError("INVALID");
			throw error;
		});
	}
	async function authorize(
		c: PoolClient,
		a: ResourceActor,
		o: string,
		t: ResourceTarget,
		p: ResourcePermission,
	) {
		validId(t.id);
		await hooks.authorize(c, a, o, t, p);
	}
	async function audit(
		c: PoolClient,
		a: ResourceActor,
		o: string,
		action: string,
		targetId: string,
		changes: Record<string, unknown> = {},
	) {
		const correlation = hooks.correlation?.();
		if (
			correlation &&
			(!/^[0-9a-f-]{36}$/i.test(correlation.requestId) ||
				(correlation.traceId && !/^[0-9a-f]{32}$/.test(correlation.traceId)))
		)
			throw new ResourceError("INVALID");
		const id = randomUUID();
		await c.query(
			"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes,request_id,trace_id) VALUES($1,$2,$3,$4,$5,$6,coalesce($7::uuid,nullif(current_setting('app.request_id',true),'')::uuid),$8)",
			[
				id,
				o,
				actorId(a),
				action,
				targetId,
				JSON.stringify(changes),
				correlation?.requestId ?? null,
				correlation?.traceId ?? null,
			],
		);
		await c.query(
			"INSERT INTO tenancy.outbox_events(id,organization_id,type,payload) VALUES($1,$2,$3,$4)",
			[id, o, action, JSON.stringify({ targetId, ...changes })],
		);
	}
	async function project(c: PoolClient, o: string, id: string) {
		validId(id);
		const row = (
			await c.query<ProjectRow>(
				"SELECT * FROM tenancy.projects WHERE organization_id=$1 AND id=$2",
				[o, id],
			)
		).rows[0];
		if (!row) throw new ResourceError("NOT_FOUND");
		return row;
	}
	async function owner(c: PoolClient, o: string, id: string) {
		validId(id);
		const r = await c.query(
			"SELECT m.id FROM tenancy.memberships m CROSS JOIN LATERAL identity.lookup_user(m.user_id) u WHERE m.organization_id=$1 AND m.id=$2 AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) AND u.lifecycle_status='active' AND u.email_verified",
			[o, id],
		);
		if (r.rowCount !== 1) throw new ResourceError("INVALID");
	}
	async function initialGrant(
		c: PoolClient,
		a: ResourceActor,
		o: string,
		id: string,
	) {
		let membershipId: string | null = null;
		if ("userId" in a)
			membershipId =
				(
					await c.query<{ id: string }>(
						"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",
						[o, a.userId],
					)
				).rows[0]?.id ?? null;
		await c.query(
			"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,membership_id,service_account_id) VALUES($1,$2,$3,'manager',$4,$5)",
			[
				randomUUID(),
				o,
				id,
				membershipId,
				"userId" in a ? null : a.serviceAccountId,
			],
		);
		return membershipId;
	}
	async function bucket(c: PoolClient, o: string) {
		await c.query(
			"INSERT INTO tenancy.capacity_buckets(id,organization_id,feature,policy_kind,capacity) VALUES($1,$2,'projects.max_active',$3,$4) ON CONFLICT(organization_id,feature) DO NOTHING",
			[
				randomUUID(),
				o,
				defaultCapacity === null ? "unlimited" : "limited",
				defaultCapacity,
			],
		);
	}
	async function projectEnabled(c: PoolClient, o: string) {
		const commercial = await commercialFeatures(c, o);
		if (commercial) assertLimit(commercial.projects, 0, 0);
		const policy = (
			await c.query<{ policy_kind: string }>(
				"SELECT policy_kind FROM tenancy.capacity_buckets WHERE organization_id=$1 AND feature='projects.max_active'",
				[o],
			)
		).rows[0];
		if (!policy || !["limited", "unlimited"].includes(policy.policy_kind))
			throw new ResourceError("DISABLED");
	}
	async function consume(c: PoolClient, o: string, key: string) {
		await bucket(c, o);
		const commercial = await commercialFeatures(c, o);
		if (commercial) {
			const used = (
				await c.query<{ consumed: number; reserved: number }>(
					"SELECT consumed,reserved FROM tenancy.capacity_buckets WHERE organization_id=$1 AND feature='projects.max_active' FOR UPDATE",
					[o],
				)
			).rows[0];
			assertLimit(commercial.projects, used.consumed + used.reserved, 1);
		}
		const reservation = await reserveCapacity(
			c,
			o,
			"projects.max_active",
			key,
			1,
			new Date(Date.now() + 60000),
		);
		await settleCapacityReservation(c, o, reservation, "committed");
	}
	async function receipt(
		c: PoolClient,
		a: ResourceActor,
		o: string,
		operation: string,
		key: string,
		input: unknown,
	) {
		validKey(key);
		const inputHash = hash(JSON.stringify(input));
		const row = (
			await c.query<{ input_hash: string; resource_id: string }>(
				"SELECT input_hash,resource_id FROM tenancy.resource_operations WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND operation_key=$4",
				[o, actorId(a), operation, key],
			)
		).rows[0];
		if (row && row.input_hash !== inputHash)
			throw new ResourceError("CONFLICT");
		return { id: row?.resource_id, inputHash };
	}
	async function record(
		c: PoolClient,
		a: ResourceActor,
		o: string,
		operation: string,
		key: string,
		inputHash: string,
		id: string,
	) {
		await c.query(
			"INSERT INTO tenancy.resource_operations(organization_id,actor_id,operation,operation_key,input_hash,resource_id) VALUES($1,$2,$3,$4,$5,$6)",
			[o, actorId(a), operation, key, inputHash, id],
		);
	}
	function encodeCursor(value: unknown) {
		const iv = randomBytes(12),
			cipher = createCipheriv("aes-256-gcm", cursorKey, iv);
		return Buffer.concat([
			iv,
			cipher.update(JSON.stringify(value)),
			cipher.final(),
			cipher.getAuthTag(),
		]).toString("base64url");
	}
	function decodeCursor(
		value: string,
		binding: string,
	): { date: string; id: string } | null {
		try {
			if (value.length > 2048) throw new Error();
			const bytes = Buffer.from(value, "base64url");
			const cipher = createDecipheriv(
				"aes-256-gcm",
				cursorKey,
				bytes.subarray(0, 12),
			);
			cipher.setAuthTag(bytes.subarray(-16));
			const parsed = JSON.parse(
				Buffer.concat([
					cipher.update(bytes.subarray(12, -16)),
					cipher.final(),
				]).toString(),
			) as { binding: string; expires: number; date: string; id: string };
			if (
				parsed.binding !== binding ||
				parsed.expires <= Date.now() ||
				!Number.isFinite(Date.parse(parsed.date))
			)
				throw new Error();
			validId(parsed.id);
			return parsed;
		} catch {
			throw new ResourceError("INVALID");
		}
	}
	async function list(
		a: ResourceActor,
		o: string,
		input: {
			limit?: number;
			cursor?: string;
			search?: string;
			status?: ProjectStatus;
			includeDeleted?: boolean;
		},
	) {
		validFields(input, [
			"limit",
			"cursor",
			"search",
			"status",
			"includeDeleted",
		]);
		const limit = input.limit ?? 20;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
			throw new ResourceError("INVALID");
		if (input.search !== undefined) validText(input.search, 0, 120);
		if (
			input.status &&
			!["active", "completed", "archived"].includes(input.status)
		)
			throw new ResourceError("INVALID");
		const binding = hash(
			JSON.stringify({
				org: o,
				actor: actorId(a),
				kind: "project",
				search: input.search ?? "",
				status: input.status ?? null,
				deleted: input.includeDeleted ?? false,
			}),
		);
		let position = input.cursor ? decodeCursor(input.cursor, binding) : null;
		return transaction(a, o, false, async (c) => {
			await authorize(
				c,
				a,
				o,
				{ type: "organization", id: o, resourceType: "project" },
				"read",
			);
			const items: unknown[] = [];
			let scanned = 0;
			let more = false;
			while (items.length < limit && scanned < 40) {
				const params: unknown[] = [
					o,
					position?.date ?? null,
					position?.id ?? null,
				];
				const clauses = [
					"organization_id=$1",
					"($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))",
				];
				if (!input.includeDeleted) clauses.push("deleted_at IS NULL");
				if (input.search) {
					params.push(`%${input.search.replace(/[\\%_]/g, "\\$&")}%`);
					clauses.push(
						`(name ILIKE $${params.length} OR description ILIKE $${params.length})`,
					);
				}
				if (input.status) {
					params.push(input.status);
					clauses.push(`status=$${params.length}`);
				}
				const batchSize = Math.min(
					20,
					40 - scanned,
					Math.max(10, limit - items.length),
				);
				params.push(batchSize);
				// Match the reviewed index ordering exactly; differing null order can force a full tenant sort.
				const rows = await c.query<ProjectRow & { cursor_created_at: string }>(
					`SELECT *,created_at::text AS cursor_created_at FROM tenancy.projects WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC NULLS LAST,id DESC NULLS LAST LIMIT $${params.length}`,
					params,
				);
				if (!rows.rowCount) {
					more = false;
					break;
				}
				const candidates = rows.rows.map((r) => ({
					target: { type: "project" as const, id: r.id },
					permission: ("deleted_at" in r && r.deleted_at
						? "restore"
						: "read") as ResourcePermission,
				}));
				const checks: boolean[] = [];
				if (hooks.checkBatch)
					checks.push(...(await hooks.checkBatch(c, a, o, candidates)));
				else
					for (const candidate of candidates)
						checks.push(
							await hooks.check(
								c,
								a,
								o,
								candidate.target,
								candidate.permission,
							),
						);
				if (checks.length !== candidates.length)
					throw new ResourceError("DENIED");

				for (let i = 0; i < rows.rows.length; i++) {
					const r = rows.rows[i];
					if (!r) continue;
					scanned++;
					position = { date: r.cursor_created_at, id: r.id };
					if (checks[i]) items.push(projectDto(r));
					if (items.length === limit) break;
				}
				more = rows.rows.length === batchSize || items.length === limit;
				if (items.length === limit || scanned >= 40) break;
				if (rows.rows.length < batchSize) {
					more = false;
					break;
				}
			}
			return {
				items: items as ReturnType<typeof projectDto>[],
				nextCursor:
					more && position
						? encodeCursor({
								...position,
								binding,
								expires: Date.now() + 15 * 60000,
							})
						: null,
			};
		});
	}
	const service = {
		async listProjects(
			a: ResourceActor,
			o: string,
			input: {
				limit?: number;
				cursor?: string;
				search?: string;
				status?: ProjectStatus;
				includeDeleted?: boolean;
			} = {},
		) {
			return (await list(a, o, input)) as {
				items: ReturnType<typeof projectDto>[];
				nextCursor: string | null;
			};
		},
		async getProject(a: ResourceActor, o: string, input: { id: string }) {
			return transaction(a, o, false, async (c) => {
				await authorize(c, a, o, { type: "project", id: input.id }, "read");
				const row = await project(c, o, input.id);
				if (row.deleted_at) throw new ResourceError("NOT_FOUND");
				return projectDto(row);
			});
		},
		async createProject(
			a: ResourceActor,
			o: string,
			input: {
				name: string;
				slug: string;
				description?: string;
				ownerMembershipId?: string | null;
				operationKey: string;
			},
		) {
			validFields(input, [
				"name",
				"slug",
				"description",
				"ownerMembershipId",
				"operationKey",
			]);
			validNameSlug(input.name, input.slug);
			validText(input.description ?? "", 0, 4000);
			return transaction(a, o, true, async (c) => {
				await authorize(
					c,
					a,
					o,
					{ type: "organization", id: o, resourceType: "project" },
					"create",
				);
				const normalized = {
					name: input.name,
					slug: input.slug,
					description: input.description ?? "",
					ownerMembershipId:
						input.ownerMembershipId === undefined
							? "creator"
							: input.ownerMembershipId,
				};
				const replay = await receipt(
					c,
					a,
					o,
					"project.create",
					input.operationKey,
					normalized,
				);
				if (replay.id) {
					await authorize(c, a, o, { type: "project", id: replay.id }, "read");
					return projectDto(await project(c, o, replay.id));
				}
				const currentMember =
					"userId" in a
						? ((
								await c.query<{ id: string }>(
									"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2",
									[o, a.userId],
								)
							).rows[0]?.id ?? null)
						: null;
				// Initial owner is the authenticated creator. Responsibility transfer is a separate future lifecycle command.
				if (
					input.ownerMembershipId &&
					input.ownerMembershipId !== currentMember
				)
					throw new ResourceError("INVALID");
				const ownerId = input.ownerMembershipId === null ? null : currentMember;
				if (ownerId) await owner(c, o, ownerId);
				await consume(
					c,
					o,
					`create:${hash(`${actorId(a)}:${input.operationKey}`)}`,
				);
				const usage = await reserveProjectUsage(
					c,
					o,
					`create:${hash(`${actorId(a)}:${input.operationKey}`)}`,
					1,
					options.defaultProjectCreatesPerMonth === null
						? { kind: "unlimited" }
						: {
								kind: "limited",
								limit: options.defaultProjectCreatesPerMonth ?? 1000,
							},
				);
				const id = randomUUID();
				await c.query(
					"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type) VALUES($1,$2,'project')",
					[id, o],
				);
				const row = (
					await c.query<ProjectRow>(
						"INSERT INTO tenancy.projects(id,organization_id,name,slug,description,owner_membership_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
						[id, o, input.name, input.slug, input.description ?? "", ownerId],
					)
				).rows[0];
				if (!row) throw new ResourceError("CONFLICT");
				await initialGrant(c, a, o, id);
				await hooks.sourceCommit(c, o);
				await settleProjectUsage(
					c,
					o,
					usage,
					"committed",
					options.usageThresholds,
				);
				await audit(c, a, o, "project.created", id, {
					version: 1,
				});
				await record(
					c,
					a,
					o,
					"project.create",
					input.operationKey,
					replay.inputHash,
					id,
				);
				return projectDto(row);
			});
		},
		async updateProject(
			a: ResourceActor,
			o: string,
			input: {
				id: string;
				version: number;
				name?: string;
				description?: string;
				status?: ProjectStatus;
			},
		) {
			validFields(input, ["id", "version", "name", "description", "status"]);
			validVersion(input.version);
			if (input.name !== undefined) validText(input.name, 1, 120);
			if (input.description !== undefined)
				validText(input.description, 0, 4000);
			if (
				input.status !== undefined &&
				!["active", "completed", "archived"].includes(input.status)
			)
				throw new ResourceError("INVALID");
			if (
				input.name === undefined &&
				input.description === undefined &&
				input.status === undefined
			)
				throw new ResourceError("INVALID");
			return transaction(a, o, false, async (c) => {
				await authorize(c, a, o, { type: "project", id: input.id }, "update");
				await projectEnabled(c, o);
				const row = (
					await c.query<ProjectRow>(
						"UPDATE tenancy.projects SET name=coalesce($4,name),description=coalesce($5,description),status=coalesce($6,status),version=version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL RETURNING *",
						[
							o,
							input.id,
							input.version,
							input.name ?? null,
							input.description ?? null,
							input.status ?? null,
						],
					)
				).rows[0];
				if (!row) throw new ResourceError("CONFLICT");
				await audit(c, a, o, "project.updated", input.id, {
					version: row.version,
					fields: (["name", "description", "status"] as const).filter(
						(key) => input[key] !== undefined,
					),
				});
				return projectDto(row);
			});
		},
		async deleteProject(
			a: ResourceActor,
			o: string,
			input: { id: string; version: number; operationKey: string },
		) {
			return changeDeletion(a, o, input, true);
		},
		async restoreProject(
			a: ResourceActor,
			o: string,
			input: { id: string; version: number; operationKey: string },
		) {
			return changeDeletion(a, o, input, false);
		},
		async grant(
			a: ResourceActor,
			o: string,
			input: {
				resourceId: string;
				subject: { kind: "membership" | "team" | "serviceAccount"; id: string };
				relation: "viewer" | "editor" | "manager" | "denied";
				expiresAt?: Date;
				operationKey: string;
			},
		) {
			validId(input.resourceId);
			validId(input.subject.id);
			if (
				!["membership", "team", "serviceAccount"].includes(
					input.subject.kind,
				) ||
				!["viewer", "editor", "manager", "denied"].includes(input.relation)
			)
				throw new ResourceError("INVALID");
			if (
				input.expiresAt &&
				(!Number.isFinite(input.expiresAt.getTime()) ||
					input.expiresAt.getTime() <= Date.now())
			)
				throw new ResourceError("INVALID");
			const affectedUsers =
				input.subject.kind === "membership"
					? await withTenantTransaction(pool, o, [], false, async (client) =>
							(
								await client.query<{ user_id: string }>(
									"SELECT user_id FROM tenancy.memberships WHERE organization_id=$1 AND id=$2",
									[o, input.subject.id],
								)
							).rows.map((row) => row.user_id),
						)
					: [];
			return transaction(
				a,
				o,
				true,
				async (c) => {
					const target = await registered(c, o, input.resourceId);
					await authorize(c, a, o, target, "share");
					if (input.relation !== "denied") await projectEnabled(c, o);
					if (input.subject.kind === "membership")
						await owner(c, o, input.subject.id);
					if (input.subject.kind === "serviceAccount") {
						const subject = await c.query(
							"SELECT id FROM tenancy.service_accounts WHERE organization_id=$1 AND id=$2 AND status='active'",
							[o, input.subject.id],
						);
						if (subject.rowCount !== 1) throw new ResourceError("INVALID");
					}
					const replay = await receipt(
						c,
						a,
						o,
						"resource.grant",
						input.operationKey,
						{
							resourceId: input.resourceId,
							subject: input.subject,
							relation: input.relation,
							expiresAt: input.expiresAt?.toISOString() ?? null,
						},
					);
					if (replay.id) {
						const previous = (
							await c.query<{ id: string }>(
								"SELECT id FROM tenancy.resource_grants WHERE organization_id=$1 AND id=$2",
								[o, replay.id],
							)
						).rows[0];
						if (!previous) throw new ResourceError("CONFLICT");
						return { id: previous.id };
					}
					const id = randomUUID();
					await c.query(
						"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,membership_id,team_id,service_account_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
						[
							id,
							o,
							input.resourceId,
							input.relation,
							input.subject.kind === "membership" ? input.subject.id : null,
							input.subject.kind === "team" ? input.subject.id : null,
							input.subject.kind === "serviceAccount" ? input.subject.id : null,
							input.expiresAt ?? null,
						],
					);
					await hooks.sourceCommit(c, o);
					await audit(c, a, o, "resource.granted", input.resourceId, {
						grantId: id,
						relation: input.relation,
						subjectKind: input.subject.kind,
					});
					await record(
						c,
						a,
						o,
						"resource.grant",
						input.operationKey,
						replay.inputHash,
						id,
					);
					return { id };
				},
				affectedUsers,
			);
		},
		async revokeGrant(a: ResourceActor, o: string, input: { grantId: string }) {
			validId(input.grantId);
			return transaction(a, o, true, async (c) => {
				const row = (
					await c.query<{ resource_id: string }>(
						"SELECT resource_id FROM tenancy.resource_grants WHERE organization_id=$1 AND id=$2",
						[o, input.grantId],
					)
				).rows[0];
				if (!row) throw new ResourceError("NOT_FOUND");
				const target = await registered(c, o, row.resource_id);
				await authorize(c, a, o, target, "share");
				await c.query(
					"DELETE FROM tenancy.resource_grants WHERE organization_id=$1 AND id=$2",
					[o, input.grantId],
				);
				await hooks.sourceCommit(c, o);
				await audit(c, a, o, "resource.grant_revoked", row.resource_id, {
					grantId: input.grantId,
				});
				return { id: input.grantId };
			});
		},
		async setProjectPolicy(
			a: ResourceActor,
			o: string,
			input: { enabled: boolean; maxActive: number | null; version?: number },
		) {
			if (
				typeof input.enabled !== "boolean" ||
				(input.maxActive !== null &&
					(!Number.isSafeInteger(input.maxActive) || input.maxActive < 0))
			)
				throw new ResourceError("INVALID");
			if (input.version !== undefined) validVersion(input.version);
			return transaction(a, o, true, async (c) => {
				await authorize(
					c,
					a,
					o,
					{ type: "organization", id: o, resourceType: "project" },
					"manage",
				);
				await bucket(c, o);
				const row = (
					await c.query<Bucket>(
						"UPDATE tenancy.capacity_buckets SET policy_kind=$2,capacity=$3,policy_version=policy_version+1 WHERE organization_id=$1 AND feature='projects.max_active' AND ($4::integer IS NULL OR policy_version=$4) RETURNING *",
						[
							o,
							!input.enabled
								? "disabled"
								: input.maxActive === null
									? "unlimited"
									: "limited",
							input.enabled ? input.maxActive : null,
							input.version ?? null,
						],
					)
				).rows[0];
				if (!row) throw new ResourceError("CONFLICT");
				await audit(c, a, o, "project.policy_changed", o, {
					policyKind: row.policy_kind,
					capacity: row.capacity,
					version: row.policy_version,
				});
				return {
					enabled:
						row.policy_kind !== "disabled" && row.policy_kind !== "missing",
					maxActive: row.capacity,
					version: row.policy_version,
					consumed: row.consumed,
					reserved: row.reserved,
				};
			});
		},
	};
	async function registered(
		c: PoolClient,
		o: string,
		id: string,
	): Promise<ResourceTarget> {
		const r = (
			await c.query<{
				resource_type: "project";
				deleted_at: Date | null;
			}>(
				"SELECT resource_type,deleted_at FROM tenancy.resource_registry WHERE organization_id=$1 AND id=$2",
				[o, id],
			)
		).rows[0];
		if (!r || r.deleted_at) throw new ResourceError("NOT_FOUND");
		return { type: r.resource_type, id };
	}
	async function changeDeletion(
		a: ResourceActor,
		o: string,
		input: { id: string; version: number; operationKey: string },
		deleting: boolean,
	) {
		validVersion(input.version);
		return transaction(a, o, true, async (c) => {
			const operation = deleting ? "project.delete" : "project.restore";
			await authorize(
				c,
				a,
				o,
				{ type: "project", id: input.id },
				deleting ? "delete" : "restore",
			);
			const row = await project(c, o, input.id);
			const replay = await receipt(c, a, o, operation, input.operationKey, {
				id: input.id,
				version: input.version,
			});
			// The operation-specific permission is rechecked above, including on retries.
			if (replay.id) return projectDto(row);
			if (row.version !== input.version || Boolean(row.deleted_at) === deleting)
				throw new ResourceError("CONFLICT");
			if (!deleting) {
				await consume(
					c,
					o,
					`restore:${hash(`${actorId(a)}:${input.operationKey}`)}`,
				);
			} else {
				const released = await c.query(
					"UPDATE tenancy.capacity_buckets SET consumed=consumed-1 WHERE organization_id=$1 AND feature='projects.max_active' AND consumed>0",
					[o],
				);
				if (released.rowCount !== 1) throw new ResourceError("CONFLICT");
			}
			const updated = (
				await c.query<ProjectRow>(
					"UPDATE tenancy.projects SET deleted_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,version=version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 RETURNING *",
					[o, input.id, deleting],
				)
			).rows[0];
			if (!updated) throw new ResourceError("CONFLICT");
			await c.query(
				"UPDATE tenancy.resource_registry SET deleted_at=$3 WHERE organization_id=$1 AND id=$2",
				[o, input.id, updated.deleted_at],
			);
			await hooks.sourceCommit(c, o);
			await audit(
				c,
				a,
				o,
				deleting ? "project.deleted" : "project.restored",
				input.id,
				{ version: updated.version },
			);
			await record(
				c,
				a,
				o,
				operation,
				input.operationKey,
				replay.inputHash,
				input.id,
			);
			return projectDto(updated);
		});
	}
	return service;
}
