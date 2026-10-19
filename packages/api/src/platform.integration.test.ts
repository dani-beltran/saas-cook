import { randomUUID } from "node:crypto";
import { createFileService } from "@saas-cook/db/files";
import { createPlatformService } from "@saas-cook/db/platform";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import { handleApi } from "./handlers";

const injected = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("./runtime", () => ({ applicationRuntime: () => injected.runtime }));
let f: Awaited<ReturnType<typeof resourceFixture>>,
	org: string,
	other: string,
	projectId: string;
beforeAll(async () => {
	f = await resourceFixture();
	const owner = await f.user();
	org = (await f.organization(owner)).id;
	other = (await f.organization(owner)).id;
	projectId = (
		await f.resources.createProject(owner, org, {
			name: "Public label",
			slug: "public-label",
			description: "private-description",
			operationKey: randomUUID(),
		})
	).id;
	injected.runtime = {
		files: createFileService(f.web, {
			authorize: f.authorization.authorizeResource,
		}),
		platform: createPlatformService(
			f.web,
			{
				authorize: f.authorization.authorizeResource,
				check: f.authorization.checkResource,
			},
			{ cursorSecret: "synthetic" },
		),
		origin: "http://localhost",
		ready: async () => {},
		identity: {
			session: async (headers: Headers) =>
				headers.get("cookie") === "synthetic" ? owner : null,
			assertCurrent: async () => new Date(Date.now() + 60_000),
		},
	};
});
afterAll(async () => {
	await f?.cleanup();
});
for (const transport of ["rpc", "rest"] as const) {
	it(`${transport} shares search/activity permissions, DTOs and bearer rejection`, async () => {
		async function call(
			operation: "search" | "activity",
			input: Record<string, unknown>,
			extra: Record<string, string> = {},
		) {
			const url = new URL(
				transport === "rpc"
					? `http://localhost/api/rpc/platform/${operation}`
					: `http://localhost/api/v1/organizations/${input.organizationId}/${operation}${operation === "activity" ? `/project/${input.resourceId}` : ""}`,
			);
			if (transport === "rest")
				for (const [key, value] of Object.entries(input))
					if (!["organizationId", "resourceId", "resourceType"].includes(key))
						url.searchParams.set(key, String(value));
			const response = await handleApi(
				new Request(url, {
					method: transport === "rpc" ? "POST" : "GET",
					headers: {
						cookie: "synthetic",
						origin: "http://localhost",
						"content-type": "application/json",
						...extra,
					},
					...(transport === "rpc"
						? { body: JSON.stringify({ json: input }) }
						: {}),
				}),
				transport,
			);
			const body = await response.json();
			return {
				status: response.status,
				body: transport === "rpc" ? body.json : body,
			};
		}
		const page = await call("search", { organizationId: org, query: "Public" });
		expect(page.status).toBe(200);
		expect(page.body.items).toEqual([
			{ id: projectId, type: "project", label: "Public label" },
		]);
		expect(JSON.stringify(page.body)).not.toContain("private-description");
		const activity = await call("activity", {
			organizationId: org,
			resourceType: "project",
			resourceId: projectId,
		});
		expect(activity.status).toBe(200);
		expect(activity.body.items[0].action).toBe("created");
		expect(
			(
				await call("activity", {
					organizationId: other,
					resourceType: "project",
					resourceId: projectId,
				})
			).status,
		).not.toBe(200);
		expect(
			(
				await call(
					"search",
					{ organizationId: org, query: "Public" },
					{ authorization: "Bearer forged" },
				)
			).status,
		).toBe(403);
		expect(
			(
				await call(
					"search",
					{ organizationId: org, query: "Public" },
					{ cookie: "" },
				)
			).status,
		).toBe(401);
		expect(
			(
				await call("search", {
					organizationId: org,
					query: "Public",
					cursor: "forged",
				})
			).status,
		).toBe(422);
	});
}

for (const transport of ["rpc", "rest"] as const) {
	it(`${transport} file endpoints reject unsupported principals and fail closed when storage is disabled`, async () => {
		const url =
			transport === "rpc"
				? "http://localhost/api/rpc/files/initiate"
				: `http://localhost/api/v1/organizations/${org}/projects/${projectId}/files`;
		const input = {
			organizationId: org,
			projectId,
			operationKey: randomUUID(),
			name: "file.txt",
			contentType: "text/plain",
			bytes: 1,
			sha256: "a".repeat(64),
		};
		async function call(authorization?: string) {
			return handleApi(
				new Request(url, {
					method: "POST",
					headers: {
						cookie: "synthetic",
						origin: "http://localhost",
						"content-type": "application/json",
						...(authorization ? { authorization } : {}),
					},
					body: JSON.stringify(transport === "rpc" ? { json: input } : input),
				}),
				transport,
			);
		}
		expect((await call()).status).toBe(412);
		expect((await call("Bearer unsupported_service_principal")).status).toBe(
			403,
		);
	});
}
