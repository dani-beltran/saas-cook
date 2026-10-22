import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { assertBinding, getPublication } from "../control";
import { fgaRequest } from "../fga";

/** Separate immutable model: only exact organization metadata readers; no customer relation. */
export const operatorModel = {
	schema_version: "1.1",
	type_definitions: [
		{ type: "operator" },
		{
			type: "organization",
			relations: { reader: { this: {} } },
			metadata: {
				relations: {
					reader: { directly_related_user_types: [{ type: "operator" }] },
				},
			},
		},
	],
};
/** Content fingerprint pinned by the BO binary and independent publication. */
export const operatorModelHash = createHash("sha256")
	.update(JSON.stringify(operatorModel))
	.digest("hex");
/** Publishes BO's model without changing customer readiness; requires the control-admin role. */
export async function publishOperatorModel(
	control: Pool,
	installationId: string,
	fgaUrl: string,
) {
	const c = await control.connect();
	try {
		if (
			(await c.query("SELECT current_user")).rows[0].current_user !==
			"saas_cook_control_admin"
		)
			throw new Error("Control administrator required");
		await c.query("BEGIN");
		await c.query("SELECT pg_advisory_xact_lock(1849202602)");
		const customer = await getPublication(c, installationId);
		const old = (
			await c.query(
				"SELECT * FROM control.operator_publications WHERE installation_id=$1",
				[installationId],
			)
		).rows[0];
		if (old?.epoch === customer.epoch && old.model_hash === operatorModelHash) {
			await c.query("COMMIT");
			return;
		}
		const store = await fgaRequest<{ id: string }>(fgaUrl, "/stores", {
			name: `backoffice-${installationId}`,
		});
		const model = await fgaRequest<{ authorization_model_id: string }>(
			fgaUrl,
			`/stores/${store.id}/authorization-models`,
			operatorModel,
		);
		if (
			!/^[A-Z0-9]{26}$/.test(store.id) ||
			!/^[A-Z0-9]{26}$/.test(model.authorization_model_id)
		)
			throw new Error("Invalid operator publication");
		await c.query(
			`INSERT INTO control.operator_publications VALUES($1,$2,$3,$4,$5) ON CONFLICT(installation_id) DO UPDATE SET epoch=$2,store_id=$3,model_id=$4,model_hash=$5`,
			[
				installationId,
				customer.epoch,
				store.id,
				model.authorization_model_id,
				operatorModelHash,
			],
		);
		await c.query("COMMIT");
	} catch (e) {
		await c.query("ROLLBACK");
		throw e;
	} finally {
		c.release();
	}
}
/** Checks independent customer/operator readiness and the current application binding; fails closed. */
export async function operatorPublication(
	control: Pool | PoolClient,
	app: PoolClient,
	installationId: string,
) {
	const customer = await getPublication(control, installationId);
	await assertBinding(app, customer);
	await app.query("SELECT backoffice.assert_compatibility()");
	const row = (
		await control.query(
			"SELECT * FROM control.operator_publications WHERE installation_id=$1 AND epoch=$2 AND model_hash=$3",
			[installationId, customer.epoch, operatorModelHash],
		)
	).rows[0];
	if (
		!row ||
		!/^[A-Z0-9]{26}$/.test(row.store_id) ||
		!/^[A-Z0-9]{26}$/.test(row.model_id)
	)
		throw new Error("Operator readiness required");
	return {
		epoch: customer.epoch,
		storeId: row.store_id as string,
		modelId: row.model_id as string,
	};
}
/** Evaluates one current grant in a fresh namespace; persisted tuples can never authorize this query. */
export async function checkOperator(
	fgaUrl: string,
	publication: { epoch: string; storeId: string; modelId: string },
	input: {
		operatorId: string;
		organizationId: string;
		installationId: string;
		environment: string;
	},
) {
	const namespace = createHash("sha256")
		.update(
			JSON.stringify({
				...input,
				epoch: publication.epoch,
				request: randomUUID(),
			}),
		)
		.digest("hex");
	const user = `operator:${namespace}`,
		object = `organization:${namespace}`;
	const response = await fgaRequest<{ allowed?: boolean }>(
		fgaUrl,
		`/stores/${publication.storeId}/check`,
		{
			authorization_model_id: publication.modelId,
			tuple_key: { user, relation: "reader", object },
			contextual_tuples: { tuple_keys: [{ user, relation: "reader", object }] },
			consistency: "HIGHER_CONSISTENCY",
		},
		"POST",
		1500,
	);
	if (response.allowed !== true)
		throw new Error("Operator authorization denied");
}
