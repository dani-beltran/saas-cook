import { createHash, randomUUID } from "node:crypto";
import {
	type CustomerCreateInput,
	type CustomerDeleteInput,
	type CustomerDto,
	type CustomerQuery,
	type CustomerUpdateInput,
	customerCreate,
	customerDelete,
	customerQuery,
	customerReference,
	customerUpdate,
} from "@common-saas/api-contracts/example-customers";
import type { Pool, PoolClient } from "pg";
import { ResourceError, type ResourceHooks } from "../resources";
import {
	appendTenantAudit,
	assertAuthorizationCurrent,
	type TenantActor,
	withTenantTransaction,
} from "../tenancy";
import { customerCursors } from "./cursor";

type Row = {
	id: string;
	organization_id: string;
	name: string;
	email: string;
	company: string | null;
	status: CustomerDto["status"];
	version: number;
	created_at: Date;
	updated_at: Date;
	deleted_at: Date | null;
	sort_value: string;
};
const columns =
	"id,organization_id,name,email,company,status,version,created_at,updated_at,deleted_at";
const dto = (r: Row): CustomerDto => ({
	id: r.id,
	organizationId: r.organization_id,
	name: r.name,
	email: r.email,
	company: r.company,
	status: r.status,
	version: r.version,
	createdAt: r.created_at.toISOString(),
	updatedAt: r.updated_at.toISOString(),
	deletedAt: r.deleted_at?.toISOString() ?? null,
});
function parse<T>(schema: { parse: (input: unknown) => T }, input: unknown): T {
	try {
		return schema.parse(input);
	} catch {
		throw new ResourceError("INVALID");
	}
}
const hash = (input: unknown) =>
	createHash("sha256").update(JSON.stringify(input)).digest("hex");

/** Business rules only. Foundation owns session/policy/FGA, fences, expiry and event writing. */
export function createExampleCustomersService(
	pool: Pool,
	hooks: Pick<ResourceHooks, "authorize" | "correlation">,
	options: { cursorSecret: string },
) {
	const cursors = customerCursors(options.cursorSecret);
	async function transaction<T>(
		actor: TenantActor,
		org: string,
		mutate: boolean,
		work: (c: PoolClient) => Promise<T>,
	) {
		if ("kind" in actor || !actor.assertCurrent)
			throw new ResourceError("DENIED");
		parse(customerReference, { id: org });
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
					mutate ? "manage" : "read",
				);
				const value = await work(c);
				await assertAuthorizationCurrent(c);
				return value;
			},
			undefined,
			false,
		);
	}
	async function read(
		c: PoolClient,
		org: string,
		id: string,
		includeDeleted = false,
	) {
		const row = (
			await c.query<Row>(
				`SELECT ${columns} FROM tenancy.example_customers WHERE organization_id=$1 AND id=$2 ${includeDeleted ? "" : "AND deleted_at IS NULL"}`,
				[org, id],
			)
		).rows[0];
		if (!row) throw new ResourceError("NOT_FOUND");
		return dto(row);
	}
	async function mutate(
		actor: TenantActor,
		org: string,
		operation: "create" | "update" | "delete",
		input: { operationKey: string },
		write: (c: PoolClient) => Promise<CustomerDto>,
	) {
		return transaction(actor, org, true, async (c) => {
			// Serialize only identical command scopes, after the canonical lifecycle fences.
			const scope = [org, actor.userId, operation, input.operationKey];
			await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
				JSON.stringify(["example-customers", ...scope]),
			]);
			const digest = hash(input);
			const prior = (
				await c.query<{ input_hash: string; customer_id: string }>(
					"SELECT input_hash,customer_id FROM tenancy.example_customer_operations WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND operation_key=$4",
					scope,
				)
			).rows[0];
			if (prior) {
				if (prior.input_hash !== digest) throw new ResourceError("CONFLICT");
				return read(c, org, prior.customer_id, true);
			}
			const result = await write(c);
			await c.query(
				"INSERT INTO tenancy.example_customer_operations(organization_id,actor_id,operation,operation_key,input_hash,customer_id) VALUES($1,$2,$3,$4,$5,$6)",
				[...scope, digest, result.id],
			);
			await appendTenantAudit(
				c,
				org,
				`user:${actor.userId}`,
				`example-customers.${operation}`,
				result.id,
				{ version: result.version },
				hooks.correlation?.(),
			);
			return result;
		});
	}
	return {
		async list(
			actor: TenantActor,
			org: string,
			raw: Partial<CustomerQuery> = {},
		) {
			const input = parse(customerQuery, raw);
			const { cursor, ...query } = input;
			const binding = hash({
				feature: "example-customers",
				actor: actor.userId,
				org,
				...query,
			});
			const position = cursor ? cursors.decode(cursor, binding) : null;
			return transaction(actor, org, false, async (c) => {
				// Identifiers/operators are selected exclusively from these constants; all data is parameterized.
				const expression =
					input.sort === "createdAt"
						? "created_at"
						: input.sort === "name"
							? 'lower(name) COLLATE "C"'
							: "coalesce(lower(company),'') COLLATE \"C\"";
				const cast = input.sort === "createdAt" ? "timestamptz" : "text";
				const direction = input.direction === "asc" ? "ASC" : "DESC";
				const compare = input.direction === "asc" ? ">" : "<";
				const empty = input.sort === "company" ? "(company IS NULL)" : "false";
				const rows = await c.query<Row>(
					`SELECT ${columns},${expression} AS sort_value FROM tenancy.example_customers
     WHERE organization_id=$1 AND deleted_at IS NULL
     AND ($2::text IS NULL OR (name ILIKE $2 OR email ILIKE $2 OR company ILIKE $2))
     AND ($3::text IS NULL OR status=$3)
     AND ($4::text IS NULL OR ${empty}>$6::boolean OR (${empty}=$6::boolean AND (${expression},id) ${compare} ($4::${cast},$5::uuid)))
     ORDER BY ${input.sort === "company" ? `${empty} ASC, ` : ""}${expression} ${direction},id ${direction} LIMIT $7`,
					[
						org,
						input.search
							? `%${input.search.replace(/[\\%_]/g, "\\$&")}%`
							: null,
						input.status ?? null,
						position?.value ?? null,
						position?.id ?? null,
						position?.empty ?? false,
						input.limit + 1,
					],
				);
				const page = rows.rows.slice(0, input.limit),
					last = page.at(-1);
				return {
					items: page.map(dto),
					nextCursor:
						rows.rows.length > input.limit && last
							? cursors.encode(binding, {
									id: last.id,
									value:
										input.sort === "createdAt"
											? last.created_at.toISOString()
											: last.sort_value,
									empty: input.sort === "company" && last.company === null,
								})
							: null,
				};
			});
		},
		async get(actor: TenantActor, org: string, raw: { id: string }) {
			const input = parse(customerReference, raw);
			return transaction(actor, org, false, (c) => read(c, org, input.id));
		},
		async create(actor: TenantActor, org: string, raw: CustomerCreateInput) {
			const input = parse(customerCreate, raw);
			return mutate(actor, org, "create", input, async (c) => {
				const row = (
					await c.query<Row>(
						`INSERT INTO tenancy.example_customers(id,organization_id,name,email,company,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${columns}`,
						[
							randomUUID(),
							org,
							input.name,
							input.email,
							input.company || null,
							input.status,
						],
					)
				).rows[0];
				return dto(row);
			});
		},
		async update(actor: TenantActor, org: string, raw: CustomerUpdateInput) {
			const input = parse(customerUpdate, raw);
			return mutate(actor, org, "update", input, async (c) => {
				await read(c, org, input.id);
				const row = (
					await c.query<Row>(
						`UPDATE tenancy.example_customers SET name=$4,email=$5,company=$6,status=$7,version=version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL RETURNING ${columns}`,
						[
							org,
							input.id,
							input.version,
							input.name,
							input.email,
							input.company || null,
							input.status,
						],
					)
				).rows[0];
				if (!row) throw new ResourceError("CONFLICT");
				return dto(row);
			});
		},
		async delete(actor: TenantActor, org: string, raw: CustomerDeleteInput) {
			const input = parse(customerDelete, raw);
			return mutate(actor, org, "delete", input, async (c) => {
				await read(c, org, input.id);
				const row = (
					await c.query<Row>(
						`UPDATE tenancy.example_customers SET deleted_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL RETURNING ${columns}`,
						[org, input.id, input.version],
					)
				).rows[0];
				if (!row) throw new ResourceError("CONFLICT");
				return dto(row);
			});
		},
	};
}
