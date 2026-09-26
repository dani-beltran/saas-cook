import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
	authorizationModel,
	compileContext,
} from "@common-saas/authz/model";

// Validate the production compiler and pinned model without modifying application readiness.
const base = process.env.OPENFGA_API_URL ?? "http://127.0.0.1:18081";
async function request<T>(
	path: string,
	method: string,
	body?: unknown,
): Promise<T> {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(10_000),
	});
	assert(response.ok, `OpenFGA ${method} ${path}: ${response.status}`);
	return response.status === 204 ? (undefined as T) : response.json();
}

const store = await request<{ id: string }>("/stores", "POST", {
	name: `phase2-model-validation-${Date.now()}`,
});
try {
	const model = await request<{ authorization_model_id: string }>(
		`/stores/${store.id}/authorization-models`,
		"POST",
		authorizationModel,
	);
	const context = compileContext({ organizationId: "alpha", epoch: "epoch", actorId: "alpha-owner", role: "owner" });
	const tuples = context.tuples;
	const assertions = [
		{ user: "user:alpha-owner", relation: "can_manage", allowed: true },
		{ user: "user:alpha-owner", relation: "can_transfer", allowed: true },
		{ user: "user:alpha-member", relation: "can_manage", allowed: false },
		{ user: "user:beta-owner", relation: "can_read", allowed: false },
	];
	for (const assertion of assertions) {
		const result = await request<{ allowed: boolean }>(
			`/stores/${store.id}/check`,
			"POST",
			{
				authorization_model_id: model.authorization_model_id,
				tuple_key: {
					user: assertion.user,
					relation: assertion.relation,
					object: context.object,
				},
				contextual_tuples: { tuple_keys: tuples },
				consistency: "HIGHER_CONSISTENCY",
			},
		);
		assert.equal(result.allowed, assertion.allowed, JSON.stringify(assertion));
	}
	await mkdir("artifacts/authz", { recursive: true });
	await writeFile(
		"artifacts/authz/model-validation.json",
		`${JSON.stringify(
			{
				status: "passed",
				modelId: model.authorization_model_id,
				assertions,
				scope:
					"Phase 2 production contextual authorization model and compiler",
			},
			null,
			2,
		)}\n`,
	);
	console.log(
		`OpenFGA accepted the model and passed ${assertions.length} contextual assertions`,
	);
} finally {
	await request(`/stores/${store.id}`, "DELETE");
}
