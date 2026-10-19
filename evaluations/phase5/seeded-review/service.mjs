import { randomUUID } from "node:crypto";
import { billingDto } from "./contracts.mjs";

async function transaction(pool, organizationId, fn) {
	const c = await pool.connect();
	try {
		await c.query("BEGIN");
		await c.query("SELECT set_config('app.organization_id',$1,true)", [
			organizationId,
		]);
		const value = await fn(c);
		await c.query("COMMIT");
		return value;
	} catch (error) {
		await c.query("ROLLBACK");
		throw error;
	} finally {
		c.release();
	}
}
export async function readBilling(pool, _actor, organizationId) {
	return transaction(pool, organizationId, async (c) => {
		const result = await c.query(
			"SELECT * FROM tenancy.billing_accounts WHERE organization_id=$1",
			[organizationId],
		);
		return result.rows.map((row) => billingDto.parse(row));
	});
}
export async function applyProviderPayload(
	pool,
	_actor,
	organizationId,
	payload,
) {
	return transaction(pool, organizationId, async (c) => {
		await c.query(
			"UPDATE tenancy.seat_capacities SET capacity=$2 WHERE organization_id=$1",
			[organizationId, payload.confirmedSeats],
		);
	});
}
export async function recordUsage(pool, _actor, organizationId, input) {
	return transaction(pool, organizationId, async (c) => {
		const id = randomUUID();
		await c.query(
			"INSERT INTO tenancy.review_usage(id,organization_id,operation_key,quantity,internal_note) VALUES($1,$2,$3,$4,$5)",
			[
				id,
				organizationId,
				input.operationKey,
				input.quantity,
				input.internalNote,
			],
		);
		return id;
	});
}
