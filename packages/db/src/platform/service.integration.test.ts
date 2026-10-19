import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { createApiKeyService } from "../../../authz/src/keys";
import { createExampleCustomersService } from "../example-customers/service";
import { withTenantTransaction } from "../tenancy";
import { createPlatformService } from "./service";
import { pruneActivity } from "./worker";

let f: Awaited<ReturnType<typeof resourceFixture>>;
let service: ReturnType<typeof createPlatformService>;
let owner: Awaited<ReturnType<typeof f.user>>,
	reader: typeof owner,
	outsider: typeof owner;
let org: string, other: string, member: string;
const projectInput = () => ({
	name: "Discovery project",
	slug: `p-${randomUUID()}`,
	operationKey: randomUUID(),
});
beforeAll(async () => {
	f = await resourceFixture({
		defaultProjectCapacity: 500,
		defaultProjectCreatesPerMonth: null,
	});
	[owner, reader, outsider] = await Promise.all([f.user(), f.user(), f.user()]);
	for (const actor of [owner, reader, outsider])
		actor.assertCurrent = async () => new Date(Date.now() + 60_000);
	org = (await f.organization(owner)).id;
	other = (await f.organization(owner)).id;
	member = await f.member(owner, org, reader);
	service = createPlatformService(
		f.web,
		{
			authorize: f.authorization.authorizeResource,
			check: f.authorization.checkResource,
		},
		{ cursorSecret: "synthetic-platform" },
	);
});
afterAll(async () => {
	await f?.cleanup();
});
describe("Phase 6 discovery on restricted PostgreSQL and OpenFGA", () => {
	it("filters cross-resource results, redacts fields and rechecks revoked access", async () => {
		const project = await f.resources.createProject(owner, org, projectInput());
		const customers = createExampleCustomersService(
			f.web,
			{ authorize: f.authorization.authorizeResource },
			{ cursorSecret: "synthetic" },
		);
		const customer = await customers.create(owner, org, {
			name: "Discovery contact",
			email: "private@example.test",
			operationKey: randomUUID(),
		});
		await f.resources.createProject(owner, other, projectInput());
		const page = await service.search(owner, org, { query: "Discovery" });
		expect(new Set(page.items.map((r) => r.type))).toEqual(
			new Set(["project", "customer"]),
		);
		expect(JSON.stringify(page)).not.toContain("private@");
		expect(page).not.toHaveProperty("total");
		expect(
			(await service.search(reader, org, { query: "Discovery" })).items.map(
				(r) => r.id,
			),
		).toEqual([customer.id]);
		await expect(
			service.search(outsider, org, { query: "Discovery" }),
		).rejects.toThrow();
		const grant = await f.resources.grant(owner, org, {
			resourceId: project.id,
			subject: { kind: "membership", id: member },
			relation: "viewer",
			operationKey: randomUUID(),
		});
		expect(
			(await service.search(reader, org, { query: "Discovery" })).items.some(
				(r) => r.id === project.id,
			),
		).toBe(true);
		await f.resources.revokeGrant(owner, org, {
			grantId: grant.id,
		});
		expect(
			(await service.search(reader, org, { query: "Discovery" })).items.some(
				(r) => r.id === project.id,
			),
		).toBe(false);
		await expect(
			service.activity(reader, org, {
				resourceType: "project",
				resourceId: project.id,
			}),
		).rejects.toThrow();
		await customers.delete(owner, org, {
			id: customer.id,
			version: customer.version,
			operationKey: randomUUID(),
		});
		expect(
			(
				await service.search(owner, org, {
					query: "Discovery",
					type: "customer",
				})
			).items,
		).toEqual([]);
		await expect(
			service.activity(owner, org, {
				resourceType: "customer",
				resourceId: customer.id,
			}),
		).rejects.toThrow();
	});
	it("bounds sparse scans and binds opaque continuation to actor, tenant, query and enabled types", async () => {
		for (let i = 0; i < 103; i++)
			await f.resources.createProject(owner, org, {
				...projectInput(),
				name: "Sparse candidate",
			});
		const page = await service.search(reader, org, {
			query: "Sparse",
			limit: 1,
		});
		expect(page.items).toEqual([]);
		expect(page.nextCursor).toBeTruthy();
		const next = await service.search(reader, org, {
			query: "Sparse",
			limit: 1,
			cursor: page.nextCursor ?? "",
		});
		expect(next.items).toEqual([]);
		expect(next.nextCursor).toBeNull();
		for (const [actor, tenant, query] of [
			[owner, org, "Sparse"],
			[reader, other, "Sparse"],
			[reader, org, "Discovery"],
		] as const) {
			await expect(
				service.search(actor, tenant, {
					query,
					limit: 1,
					cursor: page.nextCursor ?? "",
				}),
			).rejects.toMatchObject({ code: "INVALID" });
		}
		await expect(
			service.search(reader, org, {
				query: "Sparse",
				limit: 1,
				cursor: `${page.nextCursor}a`,
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		const disabled = createPlatformService(
			f.web,
			{
				authorize: f.authorization.authorizeResource,
				check: f.authorization.checkResource,
			},
			{ cursorSecret: "synthetic-platform", enabledTypes: ["customer"] },
		);
		expect(
			(await disabled.search(owner, org, { query: "Sparse" })).items,
		).toEqual([]);
		await expect(
			disabled.search(reader, org, {
				query: "Sparse",
				limit: 1,
				cursor: page.nextCursor ?? "",
			}),
		).rejects.toThrow();
	});
	it("projects safe events once, paginates stable timestamps, retains audit separately and denies wrong tenant", async () => {
		const input = projectInput(),
			project = await f.resources.createProject(owner, org, input);
		await f.resources.createProject(owner, org, input);
		await f.resources.updateProject(owner, org, {
			id: project.id,
			version: 1,
			name: "Changed",
			description: "secret payload",
			status: "active",
		});
		const first = await service.activity(owner, org, {
			resourceType: "project",
			resourceId: project.id,
			limit: 1,
		});
		expect(first.items).toHaveLength(1);
		expect(first.items[0].action).toBe("updated");
		const second = await service.activity(owner, org, {
			resourceType: "project",
			resourceId: project.id,
			limit: 1,
			cursor: first.nextCursor ?? "",
		});
		expect(second.items[0].action).toBe("created");
		expect(second.nextCursor).toBeNull();
		expect(JSON.stringify(first)).not.toContain("secret");
		expect(JSON.stringify(first)).not.toContain(owner.userId);
		await withTenantTransaction(f.web, org, [owner.userId], false, (c) =>
			c.query("SELECT tenancy.project_activity_event($1,$2)", [
				org,
				second.items[0].id,
			]),
		);
		expect(
			(
				await service.activity(owner, org, {
					resourceType: "project",
					resourceId: project.id,
				})
			).items,
		).toHaveLength(2);
		await expect(
			service.activity(owner, other, {
				resourceType: "project",
				resourceId: project.id,
			}),
		).rejects.toThrow();
		expect(
			(await f.web.query("SELECT * FROM tenancy.activity_events")).rows,
		).toEqual([]);
		await expect(
			withTenantTransaction(f.web, org, [owner.userId], false, (c) =>
				c.query(
					"DELETE FROM tenancy.activity_events WHERE organization_id=$1",
					[org],
				),
			),
		).rejects.toMatchObject({ code: "42501" });
		await f.app.query(
			"UPDATE tenancy.activity_events SET occurred_at=now()-interval '91 days' WHERE organization_id=$1 AND resource_id=$2",
			[org, project.id],
		);
		expect(
			(
				await service.activity(owner, org, {
					resourceType: "project",
					resourceId: project.id,
				})
			).items,
		).toEqual([]);
		expect(
			(
				await f.app.query(
					"SELECT id FROM tenancy.audit_events WHERE target_id=$1",
					[project.id],
				)
			).rows,
		).toHaveLength(2);
	});
	it("lists account/key metadata with manage permission and bound pagination, never hashes or secrets", async () => {
		const keys = createApiKeyService({
			pool: f.web,
			authorization: f.authorization,
		});
		const accounts = [];
		for (let i = 0; i < 3; i++)
			accounts.push(
				await keys.createAccount(owner, org, {
					name: `Account ${i}`,
					capabilities: [],
					operationKey: randomUUID(),
				}),
			);
		const first = await service.accounts(owner, org, { limit: 1 });
		expect(first.items).toHaveLength(1);
		expect(first.nextCursor).toBeTruthy();
		const second = await service.accounts(owner, org, {
			limit: 1,
			cursor: first.nextCursor ?? "",
		});
		expect(second.items[0].id).not.toBe(first.items[0].id);
		await expect(service.accounts(reader, org, {})).rejects.toThrow();
		await expect(
			service.accounts(owner, other, {
				limit: 1,
				cursor: first.nextCursor ?? "",
			}),
		).rejects.toThrow();
		const issued = await keys.issue(owner, org, {
			serviceAccountId: accounts[0].id,
			scopes: ["project:read"],
			expiresAt: new Date(Date.now() + 86400000),
			operationKey: randomUUID(),
		});
		const listed = await service.keys(owner, org, {
			serviceAccountId: accounts[0].id,
		});
		expect(listed.items[0].prefix).toBe(issued.prefix);
		expect(JSON.stringify(listed)).not.toContain(issued.secret);
		expect(listed.items[0]).not.toHaveProperty("secret_hash");
		expect(listed.items[0]).not.toHaveProperty("recovery_epoch");
		await keys.revoke(owner, org, issued.id);
		expect(
			(await service.keys(owner, org, { serviceAccountId: accounts[0].id }))
				.items[0].revokedAt,
		).not.toBeNull();
		await expect(
			service.keys(owner, other, { serviceAccountId: accounts[0].id }),
		).rejects.toThrow();
	});
	it("prunes expired activity under the restricted worker role while preserving audit and current activity", async () => {
		const worker = new Pool({
			connectionString: f.installation.env.WORKER_DATABASE_URL,
		});
		try {
			const before = Number(
				(
					await f.app.query(
						"SELECT count(*) FROM tenancy.activity_events WHERE occurred_at<=now()-interval '90 days'",
					)
				).rows[0].count,
			);
			expect(before).toBeGreaterThan(0);
			const audit = Number(
				(await f.app.query("SELECT count(*) FROM tenancy.audit_events")).rows[0]
					.count,
			);
			await expect(
				f.web.query("SELECT * FROM tenancy.activity_retention_due()"),
			).rejects.toMatchObject({ code: "42501" });
			await expect(
				pruneActivity(worker, async () => {
					throw new Error("Closed readiness");
				}),
			).rejects.toThrow("Closed readiness");
			expect(
				Number(
					(
						await f.app.query(
							"SELECT count(*) FROM tenancy.activity_events WHERE occurred_at<=now()-interval '90 days'",
						)
					).rows[0].count,
				),
			).toBe(before);
			await pruneActivity(worker, f.authorization.publication);
			expect(
				Number(
					(
						await f.app.query(
							"SELECT count(*) FROM tenancy.activity_events WHERE occurred_at<=now()-interval '90 days'",
						)
					).rows[0].count,
				),
			).toBe(0);
			expect(
				Number(
					(await f.app.query("SELECT count(*) FROM tenancy.audit_events"))
						.rows[0].count,
				),
			).toBe(audit);
			expect(
				Number(
					(await f.app.query("SELECT count(*) FROM tenancy.activity_events"))
						.rows[0].count,
				),
			).toBeGreaterThan(0);
		} finally {
			await worker.end();
		}
	});

	it("fails closed at the final expiry guard and independent readiness gate", async () => {
		const expired = createPlatformService(
			f.web,
			{
				authorize: async (c, ...args) => {
					await f.authorization.authorizeResource(c, ...args);
					await c.query(
						"SELECT set_config('app.authorization_expires_at',(clock_timestamp()-interval '1 second')::text,true)",
					);
				},
				check: f.authorization.checkResource,
			},
			{ cursorSecret: "synthetic" },
		);
		await expect(
			expired.search(owner, org, { query: "missing" }),
		).rejects.toThrow();
		await f.app.query(
			"UPDATE tenancy.authorization_revisions SET ready=false WHERE organization_id=$1",
			[other],
		);
		await expect(
			service.search(owner, other, { query: "Discovery" }),
		).rejects.toThrow();
	});
});
