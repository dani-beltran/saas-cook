import type { Pool, PoolClient } from "pg";
import { z } from "zod";

// Only trusted services may construct the tenant scope after membership validation.
// This proves pool/transaction mechanics, not an authentication boundary.
export async function tenantTransaction<T>(
	pool: Pool,
	organizationId: string,
	work: (client: PoolClient) => Promise<T>,
): Promise<T> {
	z.uuid().parse(organizationId);
	const client = await pool.connect();
	let discard: Error | undefined;
	const connectionError = (error: Error) => {
		discard = error;
	};
	client.on("error", connectionError);
	try {
		await client.query("BEGIN");
		await client.query("SELECT set_config('app.organization_id', $1, true)", [
			organizationId,
		]);
		const result = await work(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		try {
			await client.query("ROLLBACK");
		} catch (rollbackError) {
			discard =
				rollbackError instanceof Error
					? rollbackError
					: new Error("Rollback failed");
		}
		throw error;
	} finally {
		// A broken connection may emit a final error while it closes. Keep its listener
		// until collection; a healthy pooled connection must not accumulate listeners.
		if (!discard) client.removeListener("error", connectionError);
		client.release(discard);
	}
}
