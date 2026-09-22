import { describe, expect, it } from "vitest";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createHandlers, specification } from "./handlers";
import type { Router } from "./router";

for (const transport of ["rpc", "rest"] as const)
	describe(`${transport} shared service contract`, () => {
		function fixture(token = "phase0-alpha") {
			const handler = createHandlers(() => true);
			const rpc: RouterClient<Router> = createORPCClient(
				new RPCLink({
					url: "http://localhost/api/rpc",
					headers: { authorization: `Bearer ${token}` },
					fetch: (r) => handler(r, "rpc"),
				}),
			);
			return async (
				method: "read" | "update",
				input: Record<string, unknown>,
				overrideToken = token,
			) => {
				if (transport === "rpc" && overrideToken === token) {
					try {
						return { status: 200, body: await rpc[method](input as never) };
					} catch (e) {
						const error = e as { status: number; code: string; data: unknown };
						return {
							status: error.status,
							body: { code: error.code, data: error.data },
						};
					}
				}
				if (transport === "rpc") {
					const other: RouterClient<Router> = createORPCClient(
						new RPCLink({
							url: "http://localhost/api/rpc",
							headers: { authorization: `Bearer ${overrideToken}` },
							fetch: (r) => handler(r, "rpc"),
						}),
					);
					try {
						return { status: 200, body: await other[method](input as never) };
					} catch (e) {
						const error = e as { status: number; code: string; data: unknown };
						return {
							status: error.status,
							body: { code: error.code, data: error.data },
						};
					}
				}
				const { organizationId, id, ...body } = input;
				const url = `http://localhost/api/v1/organizations/${organizationId}/projects/${id}`;
				const r = await handler(
					new Request(url, {
						method: method === "read" ? "GET" : "PATCH",
						headers: {
							authorization: `Bearer ${overrideToken}`,
							"content-type": "application/json",
						},
						...(method === "update" ? { body: JSON.stringify(body) } : {}),
					}),
					"rest",
				);
				return { status: r.status, body: await r.json() };
			};
		}
		it("returns only explicit DTOs and validates tenant/principal access", async () => {
			const call = fixture();
			expect(await call("read", { organizationId: "alpha", id: "p1" })).toEqual(
				{
					status: 200,
					body: {
						id: "p1",
						organizationId: "alpha",
						name: "Alpha",
						version: 1,
					},
				},
			);
			expect(
				(await call("read", { organizationId: "beta", id: "p2" })).status,
			).toBe(403);
			expect(
				(await call("read", { organizationId: "alpha", id: "p1" }, "invalid"))
					.status,
			).toBe(401);
			expect(
				(await call("read", { organizationId: "alpha", id: "missing" })).status,
			).toBe(404);
		});
		it("rejects invalid and server-owned fields without writing", async () => {
			const call = fixture();
			const input = {
				organizationId: "alpha",
				id: "p1",
				name: "",
				version: 1,
				idempotencyKey: "k",
			};
			const invalid = await call("update", input);
			expect(invalid.status).toBe(422);
			expect(invalid.body).toMatchObject({
				code: "UNPROCESSABLE_CONTENT",
				data: {
					requestId: expect.any(String),
					issues: [{ path: ["name"], message: "Invalid value" }],
				},
			});
			expect(
				(
					await call("update", {
						...input,
						name: "New",
						internalSecret: "injected",
					})
				).status,
			).toBe(422);
			expect(
				(await call("read", { organizationId: "alpha", id: "p1" })).body,
			).toMatchObject({ name: "Alpha", version: 1 });
		});
		it("enforces concurrency, idempotency hashes and current access on retry", async () => {
			const call = fixture();
			const input = {
				organizationId: "alpha",
				id: "p1",
				name: "New",
				version: 1,
				idempotencyKey: "k",
			};
			const first = await call("update", input);
			expect(first.status).toBe(200);
			expect(first.body).toMatchObject({ name: "New", version: 2 });
			expect(await call("update", input)).toEqual(first);
			expect(
				(await call("update", { ...input, idempotencyKey: "other" })).status,
			).toBe(409);
			expect(
				(await call("update", { ...input, name: "Different" })).status,
			).toBe(409);
			expect((await call("update", input, "phase0-reader")).status).toBe(403);
		});
	});
it("fails closed unless synthetic fixtures explicitly enabled", async () => {
	expect(
		(
			await createHandlers(() => false)(
				new Request("http://localhost/api/rpc/read"),
				"rpc",
			)
		).status,
	).toBe(503);
});
it("generates REST OpenAPI schemas from shared Zod contracts", async () => {
	const doc = await specification();
	expect(
		doc.paths?.["/organizations/{organizationId}/projects/{id}"]?.get,
	).toBeDefined();
	expect(
		doc.paths?.["/organizations/{organizationId}/projects/{id}"]?.patch,
	).toBeDefined();
	expect(JSON.stringify(doc)).not.toContain("internalSecret");
	const responses =
		doc.paths?.["/organizations/{organizationId}/projects/{id}"]?.patch
			?.responses;
	for (const status of ["200", "401", "403", "404", "409", "422"])
		expect(responses?.[status]).toBeDefined();
});
// Compilation proves typed-client outputs and rejects invalid inputs.
function typeAssertions(client: RouterClient<Router>) {
	const result: Promise<{
		id: string;
		organizationId: string;
		name: string;
		version: number;
	}> = client.read({ organizationId: "alpha", id: "p1" });
	// @ts-expect-error Unknown organization fails client inference.
	void client.read({ organizationId: "outside", id: "p1" });
	void client.update({
		organizationId: "alpha",
		id: "p1",
		// @ts-expect-error Server-owned properties cannot be mutated.
		internalSecret: "bad",
	});
	return result;
}
void typeAssertions;

it("shares one idempotency receipt across RPC and REST and detects cross-transport conflicts", async () => {
	const handle = createHandlers(() => true);
	const rpc: RouterClient<Router> = createORPCClient(
		new RPCLink({
			url: "http://localhost/api/rpc",
			headers: { authorization: "Bearer phase0-alpha" },
			fetch: (request) => handle(request, "rpc"),
		}),
	);
	const rest = async (input: {
		name: string;
		version: number;
		idempotencyKey: string;
	}) => {
		const response = await handle(
			new Request("http://localhost/api/v1/organizations/alpha/projects/p1", {
				method: "PATCH",
				headers: {
					authorization: "Bearer phase0-alpha",
					"content-type": "application/json",
				},
				body: JSON.stringify(input),
			}),
			"rest",
		);
		return { status: response.status, body: await response.json() };
	};
	const first = { name: "RPC write", version: 1, idempotencyKey: "across-rpc" };
	const result = await rpc.update({
		organizationId: "alpha",
		id: "p1",
		...first,
	});
	expect(await rest(first)).toEqual({ status: 200, body: result });
	expect((await rest({ ...first, name: "changed" })).status).toBe(409);
	const second = {
		name: "REST write",
		version: 2,
		idempotencyKey: "across-rest",
	};
	const reverse = await rest(second);
	expect(reverse.status).toBe(200);
	expect(
		await rpc.update({ organizationId: "alpha", id: "p1", ...second }),
	).toEqual(reverse.body);
	await expect(
		rpc.update({
			organizationId: "alpha",
			id: "p1",
			...second,
			name: "changed",
		}),
	).rejects.toMatchObject({ status: 409 });
});
