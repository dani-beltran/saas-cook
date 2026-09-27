import { randomUUID } from "node:crypto";
import { createApiKeyService } from "@common-saas/authz";
import type { TenantActor } from "@common-saas/db/tenancy";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import { handleApi } from "./handlers";

const injected = vi.hoisted(() => ({ runtime: undefined as unknown }));
// The fixture provides a verified synthetic actor; production session handling is
// covered independently by the Better Auth browser suite. No request identity headers are trusted.
vi.mock("./runtime", () => ({ applicationRuntime: () => injected.runtime }));
let fixture: Awaited<ReturnType<typeof resourceFixture>>;
let owner: TenantActor;
let member: TenantActor;
let organizationId: string;
let otherOrganizationId: string;
const sessions = new Map<string, TenantActor>();
beforeAll(async () => {
	fixture = await resourceFixture();
	owner = await fixture.user();
	member = await fixture.user();
	organizationId = (await fixture.organization(owner)).id;
	otherOrganizationId = (await fixture.organization(owner)).id;
	await fixture.member(owner, organizationId, member);
	sessions.set("synthetic-owner", owner);
	sessions.set("synthetic-member", member);
	injected.runtime = {
		resources: fixture.resources,
		tenancy: fixture.tenancy,
		keys: createApiKeyService({
			pool: fixture.web,
			authorization: fixture.authorization,
		}),
		origin: "http://localhost",
		ready: async () => undefined,
		identity: {
			session: async (headers: Headers) =>
				sessions.get(headers.get("cookie") ?? "") ?? null,
			assertCurrent: async () => undefined,
		},
	};
});
afterAll(async () => {
	await fixture?.cleanup();
});
const routes = {
	"projects.create": {
		method: "POST",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/projects`,
	},
	"projects.get": {
		method: "GET",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/projects/${input.id}`,
	},
	"projects.list": {
		method: "GET",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/projects`,
	},
	"projects.update": {
		method: "PATCH",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/projects/${input.id}`,
	},
	"projects.delete": {
		method: "DELETE",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/projects/${input.id}`,
	},
	"projects.restore": {
		method: "POST",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/projects/${input.id}/restore`,
	},
	"grants.create": {
		method: "POST",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/resource-grants`,
	},
	"grants.revoke": {
		method: "DELETE",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/resource-grants/${input.grantId}`,
	},
	"serviceAccounts.create": {
		method: "POST",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/service-accounts`,
	},
	"serviceAccounts.issue": {
		method: "POST",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/api-keys`,
	},
	"serviceAccounts.setStatus": {
		method: "PATCH",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/service-accounts/${input.id}`,
	},
	"serviceAccounts.rotate": {
		method: "POST",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/api-keys/${input.keyId}/rotate`,
	},
	"serviceAccounts.revoke": {
		method: "DELETE",
		path: (input: Record<string, unknown>) =>
			`/organizations/${input.organizationId}/api-keys/${input.keyId}`,
	},
} as const;
for (const transport of ["rpc", "rest"] as const) {
	describe(`${transport} real Project policy and concurrency`, () => {
		async function call(
			operation: keyof typeof routes,
			input: Record<string, unknown>,
			headers: Record<string, string> = {
				cookie: "synthetic-owner",
				origin: "http://localhost",
			},
		) {
			const route = routes[operation];
			const url = new URL(
				transport === "rpc"
					? `http://localhost/api/rpc/${operation.replace(".", "/")}`
					: `http://localhost/api/v1${route.path(input)}`,
			);
			if (transport === "rest" && route.method === "GET")
				for (const [key, value] of Object.entries(input))
					if (key !== "organizationId" && key !== "id" && value !== undefined)
						url.searchParams.set(key, String(value));
			const response = await handleApi(
				new Request(url, {
					method: transport === "rpc" ? "POST" : route.method,
					headers: { "content-type": "application/json", ...headers },
					...(transport === "rpc" || route.method !== "GET"
						? {
								body: JSON.stringify(
									transport === "rpc" ? { json: input } : input,
								),
							}
						: {}),
				}),
				transport,
			);
			const raw = await response.json();
			return {
				status: response.status,
				body: transport === "rpc" ? raw.json : raw,
			};
		}
		it("creates immediately readable resources, rechecks idempotency, isolates private lists and conflicts on stale writes", async () => {
			const input = {
				organizationId,
				name: `Lifecycle ${transport}`,
				slug: `lifecycle-${transport}`,
				description: "Only current authorized readers see this",
				operationKey: randomUUID(),
			};
			const created = await call("projects.create", input);
			expect(created.status, JSON.stringify(created.body)).toBe(200);
			const id = created.body.id as string;
			expect(created.body).not.toHaveProperty("recoveryEpoch");
			expect((await call("projects.get", { organizationId, id })).status).toBe(
				200,
			);
			expect((await call("projects.create", input)).body.id).toBe(id);
			expect(
				(await call("projects.create", { ...input, name: "Changed payload" }))
					.status,
			).toBe(409);
			expect(
				(
					await call(
						"projects.get",
						{ organizationId, id },
						{ cookie: "invented-user", origin: "http://localhost" },
					)
				).status,
			).toBe(401);
			expect(
				(
					await call(
						"projects.get",
						{ organizationId, id },
						{ cookie: "synthetic-member" },
					)
				).status,
			).toBe(403);
			const privateList = await call(
				"projects.list",
				{ organizationId, search: `Lifecycle ${transport}`, limit: 1 },
				{ cookie: "synthetic-member" },
			);
			expect(privateList.status, JSON.stringify(privateList.body)).toBe(200);
			expect(privateList.body.items).toEqual([]);
			expect(privateList.body).not.toHaveProperty("total");
			const list = await call("projects.list", {
				organizationId,
				search: `Lifecycle ${transport}`,
				limit: 1,
			});
			expect(list.status, JSON.stringify(list.body)).toBe(200);
			expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([
				id,
			]);
			const edits = await Promise.all([
				call("projects.update", {
					organizationId,
					id,
					version: 1,
					name: "First edit",
				}),
				call("projects.update", {
					organizationId,
					id,
					version: 1,
					name: "Second edit",
				}),
			]);
			expect(edits.map((item) => item.status).sort()).toEqual([200, 409]);
			const removed = await call("projects.delete", {
				organizationId,
				id,
				version: 2,
				operationKey: randomUUID(),
			});
			expect(removed.status, JSON.stringify(removed.body)).toBe(200);
			const deletedList = await call("projects.list", {
				organizationId,
				includeDeleted: true,
			});
			expect(deletedList.status, JSON.stringify(deletedList.body)).toBe(200);
			expect(
				deletedList.body.items.some((item: { id: string }) => item.id === id),
			).toBe(true);
			await fixture.resources.setProjectPolicy(owner, organizationId, {
				enabled: true,
				maxActive: 0,
			});
			expect(
				(
					await call("projects.create", {
						organizationId,
						name: "Quota refusal",
						slug: `quota-${transport}`,
						operationKey: randomUUID(),
					})
				).status,
			).toBe(412);
			expect(
				(
					await call("projects.restore", {
						organizationId,
						id,
						version: 3,
						operationKey: randomUUID(),
					})
				).status,
			).toBe(412);
			await fixture.resources.setProjectPolicy(owner, organizationId, {
				enabled: true,
				maxActive: 100,
			});
			expect(
				(
					await call("projects.restore", {
						organizationId,
						id,
						version: 3,
						operationKey: randomUUID(),
					})
				).status,
			).toBe(200);
		});
		it("shares a Project directly and revokes access immediately", async () => {
			const project = await call("projects.create", {
				organizationId,
				name: `Shared ${transport}`,
				slug: `shared-${transport}`,
				operationKey: randomUUID(),
			});
			expect(project.status, JSON.stringify(project.body)).toBe(200);
			expect(project.body).not.toHaveProperty("workspaceId");
			const membershipId = (
				await fixture.app.query<{ id: string }>(
					"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2",
					[organizationId, member.userId],
				)
			).rows[0].id;
			expect(
				(
					await call(
						"projects.get",
						{ organizationId, id: project.body.id },
						{ cookie: "synthetic-member" },
					)
				).status,
			).toBe(403);
			const grant = await call("grants.create", {
				organizationId,
				resourceId: project.body.id,
				subject: { kind: "membership", id: membershipId },
				relation: "viewer",
				operationKey: randomUUID(),
			});
			expect(grant.status, JSON.stringify(grant.body)).toBe(200);
			expect(
				(
					await call(
						"projects.get",
						{ organizationId, id: project.body.id },
						{ cookie: "synthetic-member" },
					)
				).status,
			).toBe(200);
			expect(
				(
					await call(
						"projects.get",
						{ organizationId: otherOrganizationId, id: project.body.id },
						{ cookie: "synthetic-member" },
					)
				).status,
			).toBe(403);
			expect(
				(
					await call("grants.revoke", {
						organizationId,
						grantId: grant.body.id,
					})
				).status,
			).toBe(200);
			expect(
				(
					await call(
						"projects.get",
						{ organizationId, id: project.body.id },
						{ cookie: "synthetic-member" },
					)
				).status,
			).toBe(403);
		});
		it("rejects obsolete Project assignment and filters on real services", async () => {
			expect(
				(
					await call("projects.create", {
						organizationId,
						name: "Obsolete assignment",
						slug: `obsolete-${transport}`,
						workspaceId: null,
						operationKey: randomUUID(),
					})
				).status,
			).toBe(422);
			expect(
				(
					await call("projects.list", {
						organizationId,
						workspaceId: randomUUID(),
					})
				).status,
			).toBe(422);
		});
		it("rejects missing and stale account versions without lifecycle, credential or audit changes", async () => {
			const command = {
				organizationId,
				name: `Versioned ${transport}`,
				operationKey: randomUUID(),
				capabilities: ["project:read"],
			};
			const created = await call("serviceAccounts.create", command);
			expect(created.status, JSON.stringify(created.body)).toBe(200);
			expect(created.body.version).toBe(1);
			expect((await call("serviceAccounts.create", command)).body).toEqual(
				created.body,
			);
			const id = created.body.id;
			const issued = await call("serviceAccounts.issue", {
				organizationId,
				serviceAccountId: id,
				operationKey: randomUUID(),
				scopes: ["project:read"],
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			});
			expect(issued.status).toBe(200);
			async function snapshot() {
				return (
					await fixture.app.query(
						`SELECT s.status,s.version,k.revoked_at,
				 (SELECT count(*)::integer FROM tenancy.audit_events WHERE organization_id=$1 AND target_id=$2 AND action LIKE 'service_account.%') AS audits,
				 (SELECT count(*)::integer FROM tenancy.outbox_events WHERE organization_id=$1 AND payload->>'targetId'=$2 AND type LIKE 'service_account.%') AS outbox,
				 r.desired_revision FROM tenancy.service_accounts s JOIN tenancy.api_keys k ON k.organization_id=s.organization_id AND k.service_account_id=s.id JOIN tenancy.authorization_revisions r ON r.organization_id=s.organization_id WHERE s.organization_id=$1 AND s.id=$2::uuid AND k.id=$3`,
						[organizationId, id, issued.body.id],
					)
				).rows[0];
			}
			const initial = await snapshot();
			expect(
				(
					await call("serviceAccounts.setStatus", {
						organizationId,
						id,
						status: "inactive",
					})
				).status,
			).toBe(422);
			expect(await snapshot()).toEqual(initial);
			const current = await call("serviceAccounts.setStatus", {
				organizationId,
				id,
				status: "active",
				version: 1,
			});
			expect(current.status).toBe(200);
			expect(current.body).toEqual({ ...created.body, version: 2 });
			const live = await snapshot();
			expect(
				(
					await call("serviceAccounts.setStatus", {
						organizationId,
						id,
						status: "inactive",
						version: 1,
					})
				).status,
			).toBe(409);
			expect(await snapshot()).toEqual(live);
			expect(
				(
					await call(
						"projects.list",
						{ organizationId },
						{ authorization: `Bearer ${issued.body.secret}` },
					)
				).status,
			).toBe(200);
			const inactive = await call("serviceAccounts.setStatus", {
				organizationId,
				id,
				status: "inactive",
				version: 2,
			});
			expect(inactive.status).toBe(200);
			expect(inactive.body).toEqual({
				...created.body,
				status: "inactive",
				version: 3,
			});
			const revoked = await snapshot();
			expect(revoked.revoked_at).not.toBeNull();
			expect(
				(
					await call("serviceAccounts.setStatus", {
						organizationId,
						id,
						status: "active",
						version: 2,
					})
				).status,
			).toBe(409);
			expect(await snapshot()).toEqual(revoked);
			expect((await call("serviceAccounts.create", command)).body).toEqual(
				inactive.body,
			);
			expect(
				(
					await call(
						"projects.list",
						{ organizationId },
						{ authorization: `Bearer ${issued.body.secret}` },
					)
				).status,
			).toBe(403);
		});
		it("enforces real key scope, tenant binding, rotation, expiry and revocation in both transports", async () => {
			const account = await call("serviceAccounts.create", {
				organizationId,
				name: `Reader ${transport}`,
				operationKey: randomUUID(),
				capabilities: ["project:read"],
			});
			expect(account.status, JSON.stringify(account.body)).toBe(200);
			const issueInput = {
				organizationId,
				serviceAccountId: account.body.id,
				operationKey: randomUUID(),
				scopes: ["project:read"],
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			};
			const issued = await call("serviceAccounts.issue", issueInput);
			expect(issued.status, JSON.stringify(issued.body)).toBe(200);
			expect((await call("serviceAccounts.issue", issueInput)).status).toBe(
				409,
			);
			const project = await fixture.resources.createProject(
				owner,
				organizationId,
				{
					name: `Key target ${transport}`,
					slug: `key-target-${transport}`,
					operationKey: randomUUID(),
				},
			);
			await fixture.resources.grant(owner, organizationId, {
				resourceId: project.id,
				subject: { kind: "serviceAccount", id: account.body.id },
				relation: "editor",
				operationKey: randomUUID(),
			});
			const bearer = (secret: string) => ({
				authorization: `Bearer ${secret}`,
			});
			expect(
				(
					await call(
						"projects.get",
						{ organizationId, id: project.id },
						bearer(issued.body.secret),
					)
				).status,
			).toBe(200);
			expect(
				(
					await call(
						"projects.get",
						{ organizationId: otherOrganizationId, id: project.id },
						bearer(issued.body.secret),
					)
				).status,
			).toBe(403);
			expect(
				(
					await call(
						"projects.update",
						{
							organizationId,
							id: project.id,
							version: 1,
							name: "Forbidden scope",
						},
						bearer(issued.body.secret),
					)
				).status,
			).toBe(403);
			expect(
				(
					await call(
						"serviceAccounts.create",
						{
							organizationId,
							name: "Undeclared principal",
							operationKey: randomUUID(),
							capabilities: [],
						},
						bearer(issued.body.secret),
					)
				).status,
			).toBe(403);
			const rotated = await call("serviceAccounts.rotate", {
				organizationId,
				keyId: issued.body.id,
				operationKey: randomUUID(),
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			});
			expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
			expect(
				(
					await call(
						"projects.get",
						{ organizationId, id: project.id },
						bearer(issued.body.secret),
					)
				).status,
			).toBe(403);
			expect(
				(
					await call(
						"projects.get",
						{ organizationId, id: project.id },
						bearer(rotated.body.secret),
					)
				).status,
			).toBe(200);
			await fixture.app.query(
				"UPDATE tenancy.api_keys SET created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
				[rotated.body.id],
			);
			expect(
				(
					await call(
						"projects.get",
						{ organizationId, id: project.id },
						bearer(rotated.body.secret),
					)
				).status,
			).toBe(403);
			expect(
				(
					await call("serviceAccounts.revoke", {
						organizationId,
						keyId: rotated.body.id,
					})
				).status,
			).toBe(200);
		});
	});
}
