import assert from "node:assert/strict";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { Router } from "../../spikes/phase0/api-next/router";

const origin = process.env.PHASE0_API_URL ?? "http://127.0.0.1:3100";
const client: RouterClient<Router> = createORPCClient(
	new RPCLink({
		url: `${origin}/api/rpc`,
		headers: { authorization: "Bearer phase0-alpha" },
	}),
);
const rpc = await client.read({ organizationId: "alpha", id: "p1" });
const response = await fetch(
	`${origin}/api/v1/organizations/alpha/projects/p1`,
	{ headers: { authorization: "Bearer phase0-alpha" } },
);
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), rpc);
assert.equal("internalSecret" in rpc, false);
const update = {
	organizationId: "alpha" as const,
	id: "p1",
	name: "Smoke update",
	version: rpc.version,
	idempotencyKey: crypto.randomUUID(),
};
const updated = await client.update(update);
const restReplay = await fetch(
	`${origin}/api/v1/organizations/alpha/projects/p1`,
	{
		method: "PATCH",
		headers: {
			authorization: "Bearer phase0-alpha",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			name: update.name,
			version: update.version,
			idempotencyKey: update.idempotencyKey,
		}),
	},
);
assert.equal(restReplay.status, 200);
assert.deepEqual(await restReplay.json(), updated);
const restConflict = await fetch(
	`${origin}/api/v1/organizations/alpha/projects/p1`,
	{
		method: "PATCH",
		headers: {
			authorization: "Bearer phase0-alpha",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			name: "Mismatch",
			version: update.version,
			idempotencyKey: update.idempotencyKey,
		}),
	},
);
assert.equal(restConflict.status, 409);
const denied = await fetch(`${origin}/api/v1/organizations/beta/projects/p2`, {
	headers: { authorization: "Bearer phase0-alpha" },
});
assert.equal(denied.status, 403);
const invalid = await fetch(
	`${origin}/api/v1/organizations/alpha/projects/p1`,
	{
		method: "PATCH",
		headers: {
			authorization: "Bearer phase0-alpha",
			"content-type": "application/json",
		},
		body: JSON.stringify({ name: "", version: 1, idempotencyKey: "smoke" }),
	},
);
assert.equal(invalid.status, 422);
const spec = await (await fetch(`${origin}/api/openapi`)).json();
assert.ok(spec.paths["/organizations/{organizationId}/projects/{id}"].patch);
console.log(
	JSON.stringify(
		{
			status: "passed",
			runtime: process.version,
			checks: [
				"compiled Next.js RPC and REST parity",
				"cross-transport idempotency and conflict",
				"tenant denial",
				"Zod input rejection",
				"DTO allowlist",
				"OpenAPI generation",
			],
		},
		null,
		2,
	),
);
