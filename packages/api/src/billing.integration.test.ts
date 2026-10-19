import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { billingFixture } from "../../db/src/billing/fixture";
import { handleApi } from "./handlers";

const injected = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("./runtime", () => ({ applicationRuntime: () => injected.runtime }));
let f: Awaited<ReturnType<typeof billingFixture>>;
beforeAll(async () => {
	f = await billingFixture();
	injected.runtime = {
		billing: f.service,
		origin: "http://localhost",
		ready: async () => undefined,
		identity: {
			session: async (h: Headers) =>
				h.get("cookie") === "owner"
					? f.owner
					: h.get("cookie") === "outsider"
						? f.outsider
						: null,
			assertCurrent: async () => undefined,
		},
	};
});
afterAll(async () => {
	await f?.cleanup();
});
for (const transport of ["rpc", "rest"] as const) {
	async function call(
		operation: "get" | "command",
		organizationId: string,
		command?: unknown,
		cookie = "owner",
	) {
		const url =
			transport === "rpc"
				? `http://localhost/api/rpc/billing/${operation}`
				: `http://localhost/api/v1/organizations/${organizationId}/billing${operation === "command" ? "/commands" : ""}`;
		const input =
			operation === "get" ? { organizationId } : { organizationId, command };
		return handleApi(
			new Request(url, {
				method: transport === "rpc" || operation === "command" ? "POST" : "GET",
				headers: {
					cookie,
					origin: "http://localhost",
					"content-type": "application/json",
				},
				...(transport === "rpc" || operation === "command"
					? {
							body: JSON.stringify(
								transport === "rpc" ? { json: input } : input,
							),
						}
					: {}),
			}),
			transport,
		);
	}
	it(`${transport} uses real billing authorization, strict DTOs and the same idempotent command service`, async () => {
		const org = (await f.organization(f.owner)).id;
		const read = await call("get", org);
		expect(read.status).toBe(200);
		const content = await read.json(),
			snapshot = transport === "rpc" ? content.json : content;
		expect(snapshot).not.toHaveProperty("customerId");
		expect(snapshot.usage.providerCharging).toBe(false);
		expect((await call("get", org, undefined, "outsider")).status).toBe(403);
		expect((await call("get", f.otherOrg)).status).toBe(403);
		const command = {
			kind: "checkout",
			selection: { planVersionId: f.plan.id, quantity: 5 },
			locale: "en",
			operationKey: randomUUID(),
		};
		const forged = await call("command", org, {
			...command,
			customerId: "cus_forged",
		});
		expect(forged.status).toBe(422);
		const result = await call("command", org, command);
		expect(result.status).toBe(200);
		const first = await result.json();
		expect(await (await call("command", org, command)).json()).toEqual(first);
		expect((await call("command", org, command, "outsider")).status).toBe(403);
	});
}
