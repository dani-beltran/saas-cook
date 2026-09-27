import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { customerFixtureRuntime } from "../../../testing/src/example-customers/fixture";
import { createTestInstallation } from "../../../testing/src/installation";
import { handleApi } from "../handlers";

const injected = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("../runtime", () => ({ applicationRuntime: () => injected.runtime }));
let installation: Awaited<ReturnType<typeof createTestInstallation>>,
	runtime: ReturnType<typeof customerFixtureRuntime>,
	cookie: string,
	org: string,
	readerCookie: string;
beforeAll(async () => {
	installation = await createTestInstallation();
	runtime = customerFixtureRuntime(installation.env, "http://localhost");
	injected.runtime = runtime;
	const owner = await runtime.human("owner@example.test"),
		reader = await runtime.human("reader@example.test");
	cookie = owner.cookie;
	readerCookie = reader.cookie;
	org = (
		await runtime.tenancy.createOrganization(owner.actor, {
			name: "Synthetic",
			slug: `api-${randomUUID()}`,
			operationKey: randomUUID(),
		})
	).id;
	const invite = await runtime.tenancy.invite(owner.actor, org, {
		email: "reader@example.test",
		role: "member",
		operationKey: randomUUID(),
	});
	await runtime.tenancy.acceptInvitation(reader.actor, org, {
		token: runtime.invitations.get(invite.id) ?? "",
		operationKey: randomUUID(),
	});
});
afterAll(async () => {
	await runtime?.close();
	await installation?.cleanup();
});
for (const transport of ["rpc", "rest"] as const)
	describe(`Customers ${transport} through real verified sessions`, () => {
		async function call(
			action: "create" | "list" | "get" | "update" | "delete",
			input: Record<string, unknown>,
			extra: Record<string, string> = {},
		) {
			const method =
				action === "list" || action === "get"
					? "GET"
					: action === "update"
						? "PATCH"
						: action === "delete"
							? "DELETE"
							: "POST";
			const url = new URL(
				transport === "rpc"
					? `http://localhost/api/rpc/exampleCustomers/${action}`
					: `http://localhost/api/v1/organizations/${org}/example-customers${input.id ? `/${input.id}` : ""}`,
			);
			if (transport === "rest" && method === "GET")
				for (const [k, v] of Object.entries(input))
					if (!["id", "organizationId"].includes(k))
						url.searchParams.set(k, String(v));
			const response = await handleApi(
				new Request(url, {
					method: transport === "rpc" ? "POST" : method,
					headers: {
						cookie,
						origin: "http://localhost",
						"content-type": "application/json",
						...extra,
					},
					...(transport === "rpc" || method !== "GET"
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
		it("shares strict CRUD behavior, rejects bearer+cookie, and maps denied/stale states", async () => {
			const input = {
				organizationId: org,
				name: `Contact ${transport}`,
				email: `${transport}@example.test`,
				operationKey: randomUUID(),
			};
			expect(
				(
					await call("create", {
						...input,
						deletedAt: new Date().toISOString(),
					})
				).status,
			).toBe(422);
			expect(
				(await call("create", input, { cookie: readerCookie })).status,
			).toBe(403);
			for (const authorization of ["Bearer invalid", "", "Basic invalid"])
				expect(
					(await call("list", { organizationId: org }, { authorization }))
						.status,
				).toBe(403);
			expect(
				(await call("list", { organizationId: org }, { cookie: "" })).status,
			).toBe(401);
			expect(
				(await call("create", input, { origin: "https://other.test" })).status,
			).toBe(403);
			const created = await call("create", input);
			expect(created.status).toBe(200);
			const id = created.body.id;
			// Even a well-shaped bearer plus a valid human cookie is unsupported on every endpoint.
			for (const action of [
				"list",
				"get",
				"create",
				"update",
				"delete",
			] as const) {
				const payload =
					action === "list"
						? { organizationId: org }
						: action === "get"
							? { organizationId: org, id }
							: action === "create"
								? input
								: action === "delete"
									? {
											organizationId: org,
											id,
											version: 1,
											operationKey: randomUUID(),
										}
									: { ...input, id, version: 1 };
				expect(
					(
						await call(action, payload, {
							authorization: `Bearer cs_${"a".repeat(32)}_${"b".repeat(43)}`,
						})
					).status,
				).toBe(403);
			}
			expect((await call("create", input)).body.id).toBe(id);
			expect(
				(
					await call(
						"get",
						{ organizationId: org, id },
						{ cookie: readerCookie },
					)
				).body.email,
			).toBe(input.email);
			const edit = {
				...input,
				id,
				version: 1,
				name: "Edited",
				operationKey: randomUUID(),
			};
			const updated = await call("update", edit);
			expect(updated.status).toBe(200);
			expect(updated.body.version).toBe(2);
			expect(
				(await call("update", { ...edit, operationKey: randomUUID() })).status,
			).toBe(409);
			const deletion = {
				organizationId: org,
				id,
				version: 2,
				operationKey: randomUUID(),
			};
			expect((await call("delete", deletion)).status).toBe(200);
			expect((await call("delete", deletion)).status).toBe(200);
			expect((await call("get", { organizationId: org, id })).status).toBe(404);
		});
	});
