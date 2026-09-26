import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import { createApiKeyService } from "./keys";
import { ResourceAuthorizationDenied } from "./resources";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture() {
	const f = await resourceFixture();
	cleanup.push(f.cleanup);
	const owner = await f.user();
	const org = (await f.organization(owner)).id;
	const keys = createApiKeyService({
		pool: f.web,
		authorization: f.authorization,
	});
	const account = await keys.createAccount(owner, org, {
		name: "Synthetic integration",
		operationKey: randomUUID(),
		capabilities: ["project:read", "project:create"],
	});
	const issue = (
		scopes = ["project:read", "project:create", "project:update"],
	) =>
		keys.issue(owner, org, {
			serviceAccountId: account.id,
			scopes,
			operationKey: randomUUID(),
			expiresAt: new Date(Date.now() + 60_000),
		});
	return { ...f, owner, org, keys, account, issue };
}
describe("Phase 3 service accounts and scoped credentials", () => {
	it("requires current read scope to return a current DTO on a create retry", async () => {
		const f = await fixture();
		const key = await f.issue(["project:create"]);
		const actor = await f.keys.authenticate(f.org, key.secret);
		const command = {
			name: "Create only",
			slug: "create-only",
			operationKey: randomUUID(),
		};
		const project = await f.resources.createProject(actor, f.org, command);
		// The initial result contains the caller's input; retry retrieves current content that another editor may have changed.
		await expect(
			f.resources.createProject(actor, f.org, command),
		).rejects.toBeInstanceOf(ResourceAuthorizationDenied);
		const readableKey = await f.issue(["project:create", "project:read"]);
		const readableActor = await f.keys.authenticate(f.org, readableKey.secret);
		expect(
			(await f.resources.createProject(readableActor, f.org, command)).id,
		).toBe(project.id);
		expect(
			(
				await f.app.query(
					"SELECT count(*)::integer AS count FROM tenancy.projects WHERE organization_id=$1 AND slug='create-only'",
					[f.org],
				)
			).rows[0].count,
		).toBe(1);
	});
	it("replays account creation exactly and never replays an issued secret", async () => {
		const f = await fixture();
		const operationKey = randomUUID();
		const accountInput = {
			name: "Retry account",
			capabilities: ["project:read"],
			operationKey,
		};
		const account = await f.keys.createAccount(f.owner, f.org, accountInput);
		expect((await f.keys.createAccount(f.owner, f.org, accountInput)).id).toBe(
			account.id,
		);
		await expect(
			f.keys.createAccount(f.owner, f.org, {
				...accountInput,
				name: "Different",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const input = {
			serviceAccountId: account.id,
			scopes: ["project:read"],
			expiresAt: new Date(Date.now() + 60_000),
			operationKey: randomUUID(),
		};
		const issued = await f.keys.issue(f.owner, f.org, input);
		await expect(f.keys.issue(f.owner, f.org, input)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		const rotation = {
			keyId: issued.id,
			expiresAt: new Date(Date.now() + 60_000),
			operationKey: randomUUID(),
		};
		await f.keys.rotate(f.owner, f.org, rotation);
		await expect(f.keys.rotate(f.owner, f.org, rotation)).rejects.toMatchObject(
			{ code: "CONFLICT" },
		);
	});
	it("stores only a hash, declares capabilities, and intersects resource grants with key scopes", async () => {
		const f = await fixture();
		const key = await f.issue();
		const actor = await f.keys.authenticate(f.org, key.secret);
		const stored = (
			await f.app.query("SELECT * FROM tenancy.api_keys WHERE id=$1", [key.id])
		).rows[0];
		expect(stored.secret_hash).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(stored)).not.toContain(key.secret);
		const humanProject = await f.resources.createProject(f.owner, f.org, {
			name: "Private",
			slug: "private",
			operationKey: randomUUID(),
		});
		await expect(
			f.resources.getProject(actor, f.org, { id: humanProject.id }),
		).rejects.toThrow();
		const own = await f.resources.createProject(actor, f.org, {
			name: "Machine",
			slug: "machine",
			operationKey: randomUUID(),
		});
		expect(
			(await f.resources.getProject(actor, f.org, { id: own.id })).id,
		).toBe(own.id);
		expect(
			(await f.resources.listProjects(actor, f.org)).items.map((p) => p.id),
		).toEqual([own.id]);
		const readKey = await f.issue(["project:read"]);
		const readActor = await f.keys.authenticate(f.org, readKey.secret);
		await expect(
			f.resources.updateProject(readActor, f.org, {
				id: own.id,
				version: own.version,
				name: "No",
			}),
		).rejects.toThrow();
		const grants = await f.app.query(
			"SELECT id FROM tenancy.resource_grants WHERE organization_id=$1 AND resource_id=$2 AND service_account_id=$3",
			[f.org, own.id, f.account.id],
		);
		await f.resources.revokeGrant(f.owner, f.org, {
			grantId: grants.rows[0].id,
		});
		await expect(
			f.resources.getProject(actor, f.org, { id: own.id }),
		).rejects.toThrow();
	});
	it("rejects wrong tenant, expiry, revocation and rotation even for already-authenticated actors", async () => {
		const f = await fixture();
		const key = await f.issue();
		const actor = await f.keys.authenticate(f.org, key.secret);
		const project = await f.resources.createProject(actor, f.org, {
			name: "Machine",
			slug: "machine",
			operationKey: randomUUID(),
		});
		const other = (await f.organization(f.owner)).id;
		await expect(f.keys.authenticate(other, key.secret)).rejects.toThrow();
		await expect(
			f.resources.getProject(actor, other, { id: project.id }),
		).rejects.toThrow();
		const rotated = await f.keys.rotate(f.owner, f.org, {
			keyId: key.id,
			operationKey: randomUUID(),
			expiresAt: new Date(Date.now() + 60_000),
		});
		await expect(f.keys.authenticate(f.org, key.secret)).rejects.toThrow();
		await expect(
			f.resources.getProject(actor, f.org, { id: project.id }),
		).rejects.toThrow();
		const current = await f.keys.authenticate(f.org, rotated.secret);
		expect(
			(await f.resources.getProject(current, f.org, { id: project.id })).id,
		).toBe(project.id);
		await f.keys.revoke(f.owner, f.org, rotated.id);
		await expect(
			f.resources.getProject(current, f.org, { id: project.id }),
		).rejects.toThrow();
		const expired = await f.issue();
		const expiredActor = await f.keys.authenticate(f.org, expired.secret);
		await f.app.query(
			"UPDATE tenancy.api_keys SET created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
			[expired.id],
		);
		await expect(
			f.resources.getProject(expiredActor, f.org, { id: project.id }),
		).rejects.toThrow();
	});
	it("rejects fabricated scopes, missing create capabilities, inactive accounts and obsolete epochs", async () => {
		const f = await fixture();
		const key = await f.issue(["project:read"]);
		const actor = await f.keys.authenticate(f.org, key.secret);
		await expect(
			f.resources.createProject(
				{ ...actor, scopes: ["project:create"] },
				f.org,
				{ name: "No", slug: "no", operationKey: randomUUID() },
			),
		).rejects.toThrow();
		const restricted = await f.keys.createAccount(f.owner, f.org, {
			name: "Restricted",
			operationKey: randomUUID(),
			capabilities: [],
		});
		const limited = await f.keys.issue(f.owner, f.org, {
			serviceAccountId: restricted.id,
			scopes: ["project:create"],
			operationKey: randomUUID(),
			expiresAt: new Date(Date.now() + 60_000),
		});
		await expect(
			f.resources.createProject(
				await f.keys.authenticate(f.org, limited.secret),
				f.org,
				{ name: "No", slug: "no", operationKey: randomUUID() },
			),
		).rejects.toThrow();
		await f.app.query(
			"UPDATE tenancy.api_keys SET recovery_epoch=$2 WHERE id=$1",
			[key.id, randomUUID()],
		);
		await expect(f.keys.authenticate(f.org, key.secret)).rejects.toThrow();
		const active = await f.issue();
		const authenticated = await f.keys.authenticate(f.org, active.secret);
		await f.keys.setAccountStatus(f.owner, f.org, f.account.id, "inactive");
		await expect(
			f.resources.listProjects(authenticated, f.org),
		).rejects.toThrow();
		await f.keys.setAccountStatus(f.owner, f.org, f.account.id, "active");
		await expect(f.keys.authenticate(f.org, active.secret)).rejects.toThrow();
	});
	it("enforces current human administration, recent authentication, policy and nonsecret audit", async () => {
		const f = await fixture();
		const member = await f.user();
		await f.member(f.owner, f.org, member);
		await expect(
			f.keys.createAccount(member, f.org, {
				name: "No",
				operationKey: randomUUID(),
				capabilities: [],
			}),
		).rejects.toThrow();
		await expect(
			f.keys.issue({ ...f.owner, authenticatedAt: new Date(0) }, f.org, {
				serviceAccountId: f.account.id,
				scopes: ["project:read"],
				operationKey: randomUUID(),
				expiresAt: new Date(Date.now() + 60_000),
			}),
		).rejects.toThrow();
		const key = await f.issue();
		const actor = await f.keys.authenticate(f.org, key.secret);
		await f.resources.setProjectPolicy(f.owner, f.org, {
			enabled: false,
			maxActive: 10,
		});
		await expect(
			f.resources.createProject(actor, f.org, {
				name: "No",
				slug: "no",
				operationKey: randomUUID(),
			}),
		).rejects.toThrow();
		const events = await f.app.query(
			"SELECT a.changes,o.payload FROM tenancy.audit_events a JOIN tenancy.outbox_events o USING(id,organization_id) WHERE a.organization_id=$1 AND a.action LIKE 'api_key.%'",
			[f.org],
		);
		expect(events.rowCount).toBeGreaterThan(0);
		expect(JSON.stringify(events.rows)).not.toContain(key.secret);
	});
});
