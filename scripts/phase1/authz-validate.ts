import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
	authorizationModel,
	fixtureTuples,
	qualifyObject,
	qualifyTuples,
} from "../../spikes/phase0/authz/model.js";

// This checks the selected Phase 0 model against real OpenFGA. It deliberately
// creates no application readiness state; publication belongs to Phase 2.
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
	name: `phase1-model-validation-${Date.now()}`,
});
try {
	const model = await request<{ authorization_model_id: string }>(
		`/stores/${store.id}/authorization-models`,
		"POST",
		authorizationModel,
	);
	const namespace = {
		organization: "alpha",
		epoch: "epoch",
		generation: "request",
	};
	const tuples = qualifyTuples(fixtureTuples("alpha", 1), namespace);
	const assertions = [
		{ user: "user:alpha-u0", relation: "can_manage", allowed: true },
		{ user: "user:alpha-u1", relation: "can_read", allowed: true },
		{ user: "user:alpha-u1", relation: "can_manage", allowed: false },
		{ user: "user:beta-u0", relation: "can_read", allowed: false },
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
					object: qualifyObject("project:r000000", namespace),
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
					"Phase 0 selected model compatibility; production authorization remains Phase 2",
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
