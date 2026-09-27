import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { exampleCustomerInputs } from "../../../testing/src/example-customers/data";
import { withTenantTransaction } from "../tenancy";
import { createExampleCustomersService } from "./service";

let f: Awaited<ReturnType<typeof resourceFixture>>;
let service: ReturnType<typeof createExampleCustomersService>;
let owner: Awaited<ReturnType<typeof f.user>>,
	reader: typeof owner,
	outsider: typeof owner;
let org: string, other: string;
beforeAll(async () => {
	f = await resourceFixture();
	service = createExampleCustomersService(
		f.web,
		{ authorize: f.authorization.authorizeResource },
		{ cursorSecret: "synthetic-customers-cursor" },
	);
	[owner, reader, outsider] = await Promise.all([f.user(), f.user(), f.user()]);
	for (const actor of [owner, reader, outsider])
		actor.assertCurrent = async () => new Date(Date.now() + 60_000);
	org = (await f.organization(owner)).id;
	other = (await f.organization(owner)).id;
	await f.member(owner, org, reader);
});
afterAll(async () => {
	await f?.cleanup();
});
const input = () => ({
	name: "Synthetic contact",
	email: "contact@example.test",
	operationKey: randomUUID(),
});
describe("example-customers with restricted PostgreSQL and real OpenFGA", () => {
	it("persists CRUD, serializes replay, rejects stale writes, and retains private tombstones", async () => {
		const create = input();
		const [a, b] = await Promise.all([
			service.create(owner, org, create),
			service.create(owner, org, create),
		]);
		expect(a).toEqual(b);
		expect(a.status).toBe("lead");
		expect(a.company).toBeNull();
		expect(await service.get(reader, org, { id: a.id })).toEqual(a);
		await expect(service.create(reader, org, input())).rejects.toThrow();
		await expect(service.get(outsider, org, { id: a.id })).rejects.toThrow();
		await expect(service.get(owner, other, { id: a.id })).rejects.toThrow();
		await expect(
			service.create(owner, org, { ...create, name: "Changed" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const edit = {
			...input(),
			id: a.id,
			version: a.version,
			name: "Edited contact",
			status: "active" as const,
		};
		const edited = await service.update(owner, org, edit);
		expect(edited.version).toBe(2);
		expect(await service.update(owner, org, edit)).toEqual(edited);
		await expect(
			service.update(owner, org, { ...edit, operationKey: randomUUID() }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const deletion = { id: a.id, version: 2, operationKey: randomUUID() };
		const deleted = await service.delete(owner, org, deletion);
		expect(deleted.deletedAt).not.toBeNull();
		expect(await service.delete(owner, org, deletion)).toEqual(deleted);
		expect(await service.create(owner, org, create)).toEqual(deleted);
		await expect(service.get(owner, org, { id: a.id })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect((await service.list(owner, org, {})).items).toEqual([]);
		const events = (
			await f.app.query(
				"SELECT action,changes FROM tenancy.audit_events WHERE target_id=$1 ORDER BY occurred_at",
				[a.id],
			)
		).rows;
		expect(events).toHaveLength(3);
		expect(
			events.every((e) => Object.keys(e.changes).join() === "version"),
		).toBe(true);
		expect(JSON.stringify(events)).not.toContain(create.email);
		expect(
			(
				await f.app.query(
					"SELECT payload FROM tenancy.outbox_events WHERE payload->>'targetId'=$1",
					[a.id],
				)
			).rows,
		).toHaveLength(3);
	});
	it("bounds and sorts 90 persisted contacts across every order, status and search with actor/query-bound cursors", async () => {
		const inputs = exampleCustomerInputs();
		const seeded = [];
		for (const value of inputs)
			seeded.push(await service.create(owner, org, value));
		// Repeated fixture population does not duplicate contacts or events.
		expect((await service.create(owner, org, inputs[0])).id).toBe(seeded[0].id);
		for (const sort of ["name", "company", "createdAt"] as const)
			for (const direction of ["asc", "desc"] as const) {
				const items = [];
				let cursor: string | undefined;
				do {
					const page = await service.list(reader, org, {
						sort,
						direction,
						limit: 10,
						cursor,
					});
					expect(page.items.length).toBeLessThanOrEqual(10);
					items.push(...page.items);
					cursor = page.nextCursor ?? undefined;
				} while (cursor);
				const compare = (a: string, b: string) =>
					Buffer.compare(Buffer.from(a), Buffer.from(b));
				const expected = [...seeded].sort((a, b) => {
					if (
						sort === "company" &&
						(a.company === null) !== (b.company === null)
					)
						return a.company === null ? 1 : -1;
					return (
						(direction === "asc" ? 1 : -1) *
						(compare(
							(a[sort] ?? "").toLowerCase(),
							(b[sort] ?? "").toLowerCase(),
						) || compare(a.id, b.id))
					);
				});
				expect(items.map((x) => x.id)).toEqual(expected.map((x) => x.id));
			}
		const first = await service.list(owner, org, { limit: 10 });
		expect(first.nextCursor).toBeTruthy();
		for (const changed of [
			{ limit: 25 as const },
			{ sort: "company" as const },
			{ direction: "asc" as const },
			{ status: "active" as const },
			{ search: "Atlas" },
		])
			await expect(
				service.list(owner, org, {
					limit: 10,
					...changed,
					cursor: first.nextCursor ?? "",
				}),
			).rejects.toMatchObject({ code: "INVALID" });
		await expect(
			service.list(reader, org, { limit: 10, cursor: first.nextCursor ?? "" }),
		).rejects.toThrow();
		await expect(
			service.list(owner, other, { limit: 10, cursor: first.nextCursor ?? "" }),
		).rejects.toThrow();
		await expect(
			service.list(owner, org, { limit: 10, cursor: `${first.nextCursor}x` }),
		).rejects.toThrow();
		expect(
			(
				await service.list(owner, org, {
					search: "Atlas",
					status: "lead",
					limit: 50,
				})
			).items,
		).toHaveLength(15);
		expect(
			(await service.list(owner, org, { search: "contact.001@" })).items,
		).toHaveLength(1);
		expect(
			(await service.list(owner, org, { search: "Beatriz", limit: 25 })).items,
		).toHaveLength(9);
		expect(
			(await service.list(owner, org, { search: "%_" })).items,
		).toHaveLength(0);
		let cursor: string | undefined;
		const active = [];
		do {
			const p = await service.list(owner, org, {
				status: "active",
				limit: 10,
				cursor,
			});
			active.push(...p.items);
			cursor = p.nextCursor ?? undefined;
		} while (cursor);
		expect(active).toHaveLength(30);
		expect(new Set(active.map((x) => x.id)).size).toBe(30);
	});
	it("enforces missing/wrong-tenant RLS, same-tenant receipt FK and immutable server columns", async () => {
		const row = await service.create(owner, org, input());
		expect(
			(await f.web.query("SELECT id FROM tenancy.example_customers")).rows,
		).toEqual([]);
		await withTenantTransaction(
			f.web,
			other,
			[owner.userId],
			false,
			async (c) => {
				expect(
					(
						await c.query(
							"SELECT id FROM tenancy.example_customers WHERE id=$1",
							[row.id],
						)
					).rows,
				).toEqual([]);
			},
		);
		await expect(
			withTenantTransaction(f.web, org, [owner.userId], false, (c) =>
				c.query(
					"INSERT INTO tenancy.example_customer_operations(organization_id,actor_id,operation,operation_key,input_hash,customer_id) VALUES($1,$2,'create','cross-tenant',$3,$4)",
					[org, owner.userId, "a".repeat(64), randomUUID()],
				),
			),
		).rejects.toMatchObject({ code: "23503" });
		const foreign = await service.create(owner, other, input());
		await expect(
			f.app.query(
				"INSERT INTO tenancy.example_customer_operations(organization_id,actor_id,operation,operation_key,input_hash,customer_id) VALUES($1,$2,'create','cross-tenant',$3,$4)",
				[org, owner.userId, "a".repeat(64), foreign.id],
			),
		).rejects.toMatchObject({ code: "23503" });
		await expect(
			withTenantTransaction(f.web, org, [owner.userId], false, (c) =>
				c.query(
					"UPDATE tenancy.example_customers SET organization_id=$1 WHERE id=$2",
					[other, row.id],
				),
			),
		).rejects.toMatchObject({ code: "42501" });
		await expect(
			withTenantTransaction(f.web, org, [owner.userId], false, (c) =>
				c.query("DELETE FROM tenancy.example_customers WHERE id=$1", [row.id]),
			),
		).rejects.toMatchObject({ code: "42501" });
		const forced = (
			await f.app.query(
				"SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('example_customers','example_customer_operations')",
			)
		).rows;
		expect(forced).toEqual([
			{ relforcerowsecurity: true },
			{ relforcerowsecurity: true },
		]);
	});
	it("rechecks replay authorization, policy, readiness and final session expiry; faults roll back events", async () => {
		const draft = input();
		await service.create(owner, other, draft);
		const invalid = {
			...owner,
			assertCurrent: async () => {
				throw new Error("Session revoked");
			},
		};
		await expect(service.create(invalid, other, draft)).rejects.toThrow(
			"Session revoked",
		);
		await f.app.query(
			"UPDATE tenancy.organizations SET require_mfa=true WHERE id=$1",
			[other],
		);
		await expect(
			service.create({ ...owner, mfa: false }, other, draft),
		).rejects.toThrow();
		await f.app.query(
			"UPDATE tenancy.organizations SET require_mfa=false WHERE id=$1",
			[other],
		);
		await f.app.query(
			"UPDATE tenancy.authorization_revisions SET ready=false WHERE organization_id=$1",
			[other],
		);
		await expect(service.create(owner, other, draft)).rejects.toThrow();
		await f.app.query(
			"UPDATE tenancy.authorization_revisions SET ready=true WHERE organization_id=$1",
			[other],
		);
		const late = createExampleCustomersService(
			f.web,
			{
				authorize: async (c, ...args) => {
					await f.authorization.authorizeResource(c, ...args);
					await c.query(
						"SELECT set_config('app.authorization_expires_at',(clock_timestamp()+interval '50 milliseconds')::text,true)",
					);
				},
				correlation: () => ({ requestId: "invalid" }),
			},
			{ cursorSecret: "test" },
		);
		const count = async () =>
			Number(
				(
					await f.app.query(
						"SELECT count(*) FROM tenancy.example_customers WHERE organization_id=$1",
						[other],
					)
				).rows[0].count,
			);
		const before = await count();
		await expect(late.create(owner, other, input())).rejects.toThrow();
		expect(await count()).toBe(before);
		const expires = createExampleCustomersService(
			f.web,
			{
				authorize: async (c, ...args) => {
					await f.authorization.authorizeResource(c, ...args);
					await c.query(
						"SELECT set_config('app.authorization_expires_at',(clock_timestamp()-interval '1 second')::text,true)",
					);
				},
			},
			{ cursorSecret: "test" },
		);
		await expect(expires.create(owner, other, input())).rejects.toThrow();
		expect(await count()).toBe(before);
		const disconnected = createExampleCustomersService(
			f.web,
			{
				authorize: async (c, ...args) => {
					await f.authorization.authorizeResource(c, ...args);
					c.on("error", () => {});
					await c.query("SELECT pg_terminate_backend(pg_backend_pid())");
				},
			},
			{ cursorSecret: "test" },
		);
		await expect(disconnected.create(owner, other, input())).rejects.toThrow();
		expect(await count()).toBe(before);
		await f.app.query(
			"UPDATE tenancy.memberships SET status='inactive' WHERE organization_id=$1 AND user_id=$2",
			[other, owner.userId],
		);
		await expect(service.create(owner, other, draft)).rejects.toThrow();
	});
});
