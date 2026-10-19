import { createHash } from "node:crypto";
import {
	type ActivityQuery,
	activityQuery,
	keyListQuery,
	type SearchItem,
	type SearchQuery,
	searchQuery,
} from "@saas-cook/api-contracts/platform";
import type { Pool, PoolClient } from "pg";
import { ResourceError, type ResourceHooks } from "../resources";
import { type TenantActor, withTenantTransaction } from "../tenancy";
import { platformCursors } from "./cursor";

const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
	try {
		return schema.parse(value);
	} catch {
		throw new ResourceError("INVALID");
	}
}
/** Registered source types are queried directly: there is no stale search document to trust. */
export function createPlatformService(
	pool: Pool,
	hooks: Pick<ResourceHooks, "authorize" | "check">,
	options: {
		cursorSecret: string;
		enabledTypes?: readonly SearchItem["type"][];
	},
) {
	const cursors = platformCursors(options.cursorSecret);
	const enabled = new Set(options.enabledTypes ?? ["project", "customer"]);
	const target = (org: string, type: SearchItem["type"], id: string) =>
		type === "project"
			? { type: "project" as const, id }
			: { type: "organization" as const, id: org };
	async function transaction<T>(
		actor: TenantActor,
		org: string,
		work: (c: PoolClient) => Promise<T>,
		permission: "read" | "manage" = "read",
	) {
		if ("kind" in actor || !actor.assertCurrent)
			throw new ResourceError("DENIED");
		return withTenantTransaction(
			pool,
			org,
			[actor.userId],
			false,
			async (c) => {
				await hooks.authorize(
					c,
					actor,
					org,
					{ type: "organization", id: org },
					permission,
				);
				return work(c);
			},
			undefined,
			false,
		);
	}
	async function inventory(
		actor: TenantActor,
		org: string,
		raw: { serviceAccountId?: string; cursor?: string; limit?: number },
		kind: "accounts" | "keys",
	) {
		const input = parse(keyListQuery, raw);
		if (kind === "keys" && !input.serviceAccountId)
			throw new ResourceError("INVALID");
		const { cursor, ...query } = input,
			binding = digest({ endpoint: kind, org, actor: actor.userId, query });
		const position = cursor ? cursors.decode(cursor, binding) : null;
		return transaction(
			actor,
			org,
			async (c) => {
				const accountId = input.serviceAccountId ?? null;
				if (
					kind === "keys" &&
					!(
						await c.query(
							"SELECT id FROM tenancy.service_accounts WHERE organization_id=$1 AND id=$2",
							[org, accountId],
						)
					).rowCount
				)
					throw new ResourceError("NOT_FOUND");
				const rows = (
					await c.query(
						kind === "accounts"
							? "SELECT id,name,status,capabilities,version FROM tenancy.service_accounts WHERE organization_id=$1 AND ($2::uuid IS NULL OR id>$2) AND $3::uuid IS NULL ORDER BY id LIMIT $4"
							: "SELECT id,prefix,scopes,expires_at,revoked_at,last_used_at FROM tenancy.api_keys WHERE organization_id=$1 AND ($2::uuid IS NULL OR id>$2) AND service_account_id=$3 ORDER BY id LIMIT $4",
						[org, position?.id ?? null, accountId, input.limit + 1],
					)
				).rows;
				const page = rows.slice(0, input.limit),
					last = page.at(-1);
				return {
					rows: page,
					nextCursor:
						rows.length > input.limit && last
							? cursors.encode(binding, { id: last.id, value: kind })
							: null,
				};
			},
			"manage",
		);
	}
	return {
		async accounts(
			actor: TenantActor,
			org: string,
			input: { cursor?: string; limit?: number },
		) {
			const page = await inventory(actor, org, input, "accounts");
			return {
				items: page.rows.map((row) => ({
					id: row.id as string,
					name: row.name as string,
					status: row.status as "active" | "inactive",
					capabilities: row.capabilities as string[],
					version: row.version as number,
				})),
				nextCursor: page.nextCursor,
			};
		},
		async keys(
			actor: TenantActor,
			org: string,
			input: { serviceAccountId: string; cursor?: string; limit?: number },
		) {
			const page = await inventory(actor, org, input, "keys");
			return {
				items: page.rows.map((row) => ({
					id: row.id as string,
					prefix: row.prefix as string,
					scopes: row.scopes as string[],
					expiresAt: (row.expires_at as Date).toISOString(),
					revokedAt: (row.revoked_at as Date | null)?.toISOString() ?? null,
					lastUsedAt: (row.last_used_at as Date | null)?.toISOString() ?? null,
				})),
				nextCursor: page.nextCursor,
			};
		},
		async search(actor: TenantActor, org: string, raw: SearchQuery) {
			const input = parse(searchQuery, raw);
			const { cursor, ...query } = input;
			const types = [...enabled]
				.sort()
				.filter((type) => !input.type || input.type === type);
			const binding = digest({
				endpoint: "search",
				actor: actor.userId,
				org,
				query,
				types,
			});
			const position = cursor ? cursors.decode(cursor, binding) : null;
			return transaction(actor, org, async (c) => {
				// Fixed SQL registry and allowlisted fields. Bound authorization work to 100 candidates.
				const rows = (
					await c.query<SearchItem>(
						`SELECT * FROM (
     SELECT id,'project'::text AS type,name AS label FROM tenancy.projects WHERE organization_id=$1 AND deleted_at IS NULL AND 'project'=ANY($2::text[]) AND to_tsvector('simple',name) @@ plainto_tsquery('simple',$3)
     UNION ALL
     SELECT id,'customer'::text AS type,name AS label FROM tenancy.example_customers WHERE organization_id=$1 AND deleted_at IS NULL AND 'customer'=ANY($2::text[]) AND to_tsvector('simple',name) @@ plainto_tsquery('simple',$3)
    ) candidates WHERE ($4::text IS NULL OR (type COLLATE "C",id)>($4::text COLLATE "C",$5::uuid)) ORDER BY type COLLATE "C",id LIMIT 101`,
						[
							org,
							types,
							input.query,
							position?.value ?? null,
							position?.id ?? null,
						],
					)
				).rows;
				const items: SearchItem[] = [];
				let scanned = 0;
				for (const row of rows.slice(0, 100)) {
					scanned++;
					if (
						await hooks.check(
							c,
							actor,
							org,
							target(org, row.type, row.id),
							"read",
						)
					)
						items.push(row);
					if (items.length === input.limit) break;
				}
				const last = rows[scanned - 1];
				return {
					items,
					nextCursor:
						last && scanned < rows.length
							? cursors.encode(binding, { id: last.id, value: last.type })
							: null,
				};
			});
		},
		async activity(actor: TenantActor, org: string, raw: ActivityQuery) {
			const input = parse(activityQuery, raw);
			if (!enabled.has(input.resourceType)) throw new ResourceError("DISABLED");
			const { cursor, ...query } = input;
			const binding = digest({
				endpoint: "activity",
				actor: actor.userId,
				org,
				query,
			});
			const position = cursor ? cursors.decode(cursor, binding) : null;
			if (position && !Number.isFinite(Date.parse(position.value)))
				throw new ResourceError("INVALID");
			return transaction(actor, org, async (c) => {
				await hooks.authorize(
					c,
					actor,
					org,
					target(org, input.resourceType, input.resourceId),
					"read",
				);
				const table =
					input.resourceType === "project" ? "projects" : "example_customers";
				if (
					!(
						await c.query(
							`SELECT 1 FROM tenancy.${table} WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`,
							[org, input.resourceId],
						)
					).rowCount
				)
					throw new ResourceError("NOT_FOUND");
				const rows = (
					await c.query<{
						source_id: string;
						action: "created" | "updated" | "deleted" | "restored";
						actor: "member" | "service" | "system";
						occurred_at: Date;
					}>(
						`SELECT source_id,action,actor,occurred_at FROM tenancy.activity_events WHERE organization_id=$1 AND resource_type=$2 AND resource_id=$3 AND occurred_at > clock_timestamp()-interval '90 days' AND ($4::timestamptz IS NULL OR (occurred_at,source_id)<($4,$5::uuid)) ORDER BY occurred_at DESC,source_id DESC LIMIT $6`,
						[
							org,
							input.resourceType,
							input.resourceId,
							position?.value ?? null,
							position?.id ?? null,
							input.limit + 1,
						],
					)
				).rows;
				const page = rows.slice(0, input.limit),
					last = page.at(-1);
				return {
					items: page.map((row) => ({
						id: row.source_id,
						action: row.action,
						actor: row.actor,
						occurredAt: row.occurred_at.toISOString(),
						schemaVersion: 1 as const,
					})),
					nextCursor:
						rows.length > input.limit && last
							? cursors.encode(binding, {
									id: last.source_id,
									value: last.occurred_at.toISOString(),
								})
							: null,
				};
			});
		},
	};
}
