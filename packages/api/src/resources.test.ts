import { ResourceAuthorizationDenied } from "@common-saas/authz";
import { ResourceError } from "@common-saas/db/resources";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleApi, specification } from "./handlers";

const fixture = vi.hoisted(() => {
	const organizationId = "10000000-0000-4000-8000-000000000001";
	const id = "20000000-0000-4000-8000-000000000002";
	const project = {
		id,
		organizationId,
		name: "Reference project",
		slug: "reference-project",
		description: "A synthetic project",
		status: "active",
		ownerMembershipId: "30000000-0000-4000-8000-000000000003",
		workspaceId: null,
		version: 1,
		createdAt: "2026-09-26T09:00:00.000Z",
		updatedAt: "2026-09-26T09:00:00.000Z",
		deletedAt: null,
	};
	const human = {
		userId: "verified-user",
		authenticatedAt: new Date(),
		mfa: true,
		method: "passkey",
	};
	const service = {
		kind: "service",
		organizationId,
		serviceAccountId: "40000000-0000-4000-8000-000000000004",
		apiKeyId: "50000000-0000-4000-8000-000000000005",
		token: "test_key_synthetic_secret",
		scopes: ["project:read"],
	};
	const runtime = {
		origin: "http://localhost",
		ready: vi.fn(async () => undefined),
		identity: {
			session: vi.fn(async () => human),
			assertCurrent: vi.fn(async () => undefined),
		},
		resources: {
			createProject: vi.fn(async () => project),
			updateProject: vi.fn(async () => project),
			getProject: vi.fn(async () => project),
			listProjects: vi.fn(async () => ({ items: [project], nextCursor: null })),
			grant: vi.fn(async () => ({ id })),
		},
		keys: { authenticate: vi.fn(async () => service), createAccount: vi.fn() },
	};
	return { organizationId, id, project, human, service, runtime };
});
vi.mock("./runtime", () => ({ applicationRuntime: () => fixture.runtime }));
beforeEach(() => {
	vi.clearAllMocks();
	fixture.runtime.resources.updateProject.mockResolvedValue(fixture.project);
	fixture.runtime.resources.createProject.mockResolvedValue(fixture.project);
	fixture.runtime.keys.authenticate.mockResolvedValue(fixture.service);
});

for (const transport of ["rpc", "rest"] as const) {
	describe(`${transport} resource boundary`, () => {
		async function call(
			operation: "create" | "update" | "get" | "list",
			input: Record<string, unknown>,
			headers: Record<string, string> = {
				cookie: "verified-session=synthetic",
				origin: "http://localhost",
			},
		) {
			const read = operation === "get" || operation === "list";
			const url =
				transport === "rpc"
					? `http://localhost/api/rpc/projects/${operation}`
					: `http://localhost/api/v1/organizations/${fixture.organizationId}/projects${operation === "get" || operation === "update" ? `/${fixture.id}` : ""}`;
			const response = await handleApi(
				new Request(url, {
					method:
						transport === "rpc" || operation === "create"
							? "POST"
							: operation === "update"
								? "PATCH"
								: "GET",
					headers: { "content-type": "application/json", ...headers },
					...(transport === "rpc"
						? { body: JSON.stringify({ json: input }) }
						: !read
							? { body: JSON.stringify(input) }
							: {}),
				}),
				transport,
			);
			const body = await response.json();
			return { response, body: transport === "rpc" ? body.json : body };
		}
		const create = () => ({
			organizationId: fixture.organizationId,
			name: "Reference project",
			slug: "reference-project",
			operationKey: "create-operation-001",
		});
		it("uses the current verified actor and shared transactional service", async () => {
			const { response, body } = await call("create", create());
			expect(response.status).toBe(200);
			expect(body).toEqual(fixture.project);
			expect(fixture.runtime.resources.createProject).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: fixture.human.userId,
					assertCurrent: expect.any(Function),
				}),
				fixture.organizationId,
				create(),
			);
			expect(response.headers.get("cache-control")).toBe("no-store");
		});
		it("denies absent identity and browser mutation without the configured origin", async () => {
			expect((await call("create", create(), {})).response.status).toBe(401);
			expect(
				(await call("create", create(), { cookie: "synthetic" })).response
					.status,
			).toBe(403);
			expect(
				(
					await call("create", create(), {
						cookie: "synthetic",
						origin: "https://attacker.invalid",
					})
				).response.status,
			).toBe(403);
			expect(fixture.runtime.resources.createProject).not.toHaveBeenCalled();
		});
		it("authenticates a key for the path organization and passes its live credential for fenced revalidation", async () => {
			const { response } = await call(
				"get",
				{ organizationId: fixture.organizationId, id: fixture.id },
				{ authorization: "Bearer test_key_synthetic_secret" },
			);
			expect(response.status).toBe(200);
			expect(fixture.runtime.keys.authenticate).toHaveBeenCalledWith(
				fixture.organizationId,
				"test_key_synthetic_secret",
			);
			expect(fixture.runtime.resources.getProject).toHaveBeenCalledWith(
				fixture.service,
				fixture.organizationId,
				{ organizationId: fixture.organizationId, id: fixture.id },
			);
			expect(fixture.runtime.identity.session).not.toHaveBeenCalled();
		});
		it("does not fall back to a cookie for a rejected bearer credential", async () => {
			fixture.runtime.keys.authenticate.mockRejectedValueOnce(
				new ResourceAuthorizationDenied(),
			);
			const { response } = await call(
				"get",
				{ organizationId: fixture.organizationId, id: fixture.id },
				{
					cookie: "valid-session",
					authorization: "Bearer test_key_synthetic_secret",
				},
			);
			expect(response.status).toBe(403);
			expect(fixture.runtime.identity.session).not.toHaveBeenCalled();
		});
		it("returns concurrency and quota failures with correlation", async () => {
			fixture.runtime.resources.updateProject.mockRejectedValueOnce(
				new ResourceError("CONFLICT"),
			);
			const conflict = await call("update", {
				organizationId: fixture.organizationId,
				id: fixture.id,
				version: 1,
				name: "Edited",
			});
			expect(conflict.response.status).toBe(409);
			expect(conflict.body).toMatchObject({
				code: "CONFLICT",
				data: { requestId: expect.any(String) },
			});
			fixture.runtime.resources.createProject.mockRejectedValueOnce(
				new ResourceError("CAPACITY"),
			);
			const capacity = await call("create", create());
			expect(capacity.response.status).toBe(412);
			expect(capacity.body.message).toBe("CAPACITY");
		});
		it("rejects forged ownership and caller policy fields before the service", async () => {
			const result = await call("create", {
				...create(),
				ownerMembershipId: fixture.project.ownerMembershipId,
				authorizationRevision: 999,
			});
			expect(result.response.status).toBe(422);
			expect(fixture.runtime.resources.createProject).not.toHaveBeenCalled();
		});
		it("rejects service principals for sharing and key provisioning", async () => {
			const response = await handleApi(
				new Request(
					transport === "rpc"
						? "http://localhost/api/rpc/serviceAccounts/create"
						: `http://localhost/api/v1/organizations/${fixture.organizationId}/service-accounts`,
					{
						method: "POST",
						headers: {
							authorization: "Bearer test_key_synthetic_secret",
							"content-type": "application/json",
						},
						body: JSON.stringify(
							transport === "rpc"
								? {
										json: {
											organizationId: fixture.organizationId,
											name: "Automation",
											operationKey: "account-operation-001",
											capabilities: [],
										},
									}
								: {
										name: "Automation",
										operationKey: "account-operation-001",
										capabilities: [],
									},
						),
					},
				),
				transport,
			);
			expect(response.status).toBe(403);
			expect(fixture.runtime.keys.authenticate).not.toHaveBeenCalled();
			expect(fixture.runtime.keys.createAccount).not.toHaveBeenCalled();
		});
		it("rejects bodies over the streaming limit before authentication", async () => {
			const result = await call("create", {
				...create(),
				description: "x".repeat(70 * 1024),
			});
			expect(result.response.status).toBe(413);
			expect(fixture.runtime.identity.session).not.toHaveBeenCalled();
		});
	});
}
it("documents both resource mutations and safe errors in public OpenAPI", async () => {
	const document = await specification();
	expect(
		document.paths?.["/organizations/{organizationId}/projects/{id}"]?.patch
			?.responses?.["409"],
	).toBeDefined();
	expect(
		document.paths?.["/organizations/{organizationId}/projects"]?.post
			?.responses?.["412"],
	).toBeDefined();
	expect(
		document.paths?.["/organizations/{organizationId}/api-keys/{keyId}/rotate"]
			?.post,
	).toBeDefined();
});
