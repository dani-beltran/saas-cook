import { widgetDto } from "./contracts.mjs";

export async function listWidgets(pool, _actor, organizationId) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query("SELECT set_config('app.organization_id',$1,true)", [
			organizationId,
		]);
		const result = await client.query(
			"SELECT * FROM tenancy.review_widgets WHERE organization_id=$1 ORDER BY id LIMIT 50",
			[organizationId],
		);
		const items = result.rows.map((row) => widgetDto.parse(row));
		await client.query("COMMIT");
		return items;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
