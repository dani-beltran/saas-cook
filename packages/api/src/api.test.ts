import { randomUUID } from "node:crypto";
import type { DiagnosticDto } from "@common-saas/api-contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { describe, expect, it } from "vitest";
import { type ApiClient, createApiClient } from "./client";
import { handleApi, specification } from "./handlers";

function client(): ApiClient {
	return createORPCClient(
		new RPCLink({
			url: "http://localhost/api/rpc",
			fetch: (request) => handleApi(request, "rpc"),
		}),
	);
}
for (const transport of ["rpc", "rest"] as const) {
	describe(`${transport} public diagnostic contract`, () => {
		async function call(input: unknown) {
			if (transport === "rpc") {
				try {
					return {
						status: 200,
						body: await client().diagnostics.echo(input as never),
					};
				} catch (error) {
					const failure = error as {
						status: number;
						code: string;
						data: unknown;
					};
					return {
						status: failure.status,
						body: { code: failure.code, data: failure.data },
					};
				}
			}
			const response = await handleApi(
				new Request("http://localhost/api/v1/diagnostics/echo", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
				}),
				"rest",
			);
			return { status: response.status, body: await response.json() };
		}
		it("returns an explicit DTO from the shared service", async () => {
			const result = await call({ message: " hello ", locale: "es" });
			expect(result).toEqual({
				status: 200,
				body: { message: "hello", locale: "es", requestId: expect.any(String) },
			});
		});
		it.each([
			{ message: "", locale: "en" },
			{ message: "x".repeat(121), locale: "en" },
			{ message: "hello", locale: "xx" },
			{ message: "hello", locale: "en", organizationId: "injected" },
		])(
			"rejects invalid/unknown fields with the same safe error shape",
			async (input) => {
				const result = await call(input);
				expect(result.status).toBe(422);
				expect(result.body).toMatchObject({
					code: "UNPROCESSABLE_CONTENT",
					data: { requestId: expect.any(String), issues: expect.any(Array) },
				});
				expect(JSON.stringify(result.body)).not.toContain("injected");
			},
		);
	});
}
it("generates public OpenAPI from the same schemas", async () => {
	const document = await specification();
	const operation = document.paths?.["/diagnostics/echo"]?.post;
	expect(operation?.responses?.["200"]).toBeDefined();
	expect(operation?.responses?.["422"]).toBeDefined();
	expect(Object.keys(document.paths ?? {})).toContain("/organizations/{organizationId}");
	expect(document.paths?.["/organizations"]?.post?.responses?.["401"]).toBeDefined();
});
it("returns safe uncached request correlation and exposes no Phase 3 resource routes", async () => {
	const response = await handleApi(
		new Request("http://localhost/api/v1/organizations/alpha/projects", {
			headers: {
				authorization: "Bearer phase0-alpha",
				"x-request-id": "sensitive-injected-value",
			},
		}),
		"rest",
	);
	expect(response.status).toBe(404);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
});
it("creates a browser-safe inferred client", async () => {
	const requestId = randomUUID();
	const fetcher: typeof fetch = async () =>
		new Response(
			JSON.stringify({ json: { message: "hello", locale: "en", requestId } }),
			{ headers: { "content-type": "application/json" } },
		);
	const output: DiagnosticDto = await createApiClient(
		"http://localhost/api/rpc",
		fetcher,
	).diagnostics.echo({ message: "hello", locale: "en" });
	expect(output.requestId).toBe(requestId);
});
// Compile-time acceptance: public inputs and outputs infer from the contract.
function typeAssertions(api: ApiClient): Promise<DiagnosticDto> {
	// @ts-expect-error Arbitrary locales are not accepted by the typed client.
	void api.diagnostics.echo({ message: "hello", locale: "fr" });
	void api.diagnostics.echo({
		message: "hello",
		locale: "en",
		// @ts-expect-error Tenant/actor claims are not writable diagnostic inputs.
		organizationId: "forged",
	});
	return api.diagnostics.echo({ message: "hello", locale: "en" });
}
void typeAssertions;

for (const transport of ["rpc", "rest"] as const) {
 it(`${transport} refuses spoofed fixture identity and tenant headers`, async () => {
  const headers = {"x-user-id":"owner", "x-organization-id":"alpha", authorization:"Bearer phase0-owner"};
  const response = await handleApi(new Request(transport === "rest" ? "http://localhost/api/v1/organizations" : "http://localhost/api/rpc/organizations/list", transport === "rest" ? {headers} : {method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({json:{}})}),transport);
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
 });
}
