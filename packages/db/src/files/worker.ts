import type { Pool, PoolClient } from "pg";
import { settleCapacityReservation } from "../resources";
import { withTenantTransaction } from "../tenancy";
import type { FileStorage } from "./storage";
/** A physical allocation is released only after confirmed provider cleanup. */
export async function pruneFiles(
	pool: Pool,
	storage: FileStorage | undefined,
	ready: (c: PoolClient) => Promise<unknown>,
) {
	if (!storage) return;
	const tenants = (
		await pool.query<{ organization_id: string }>(
			"SELECT organization_id FROM tenancy.file_cleanup_due()",
		)
	).rows;
	for (const { organization_id: org } of tenants) {
		await withTenantTransaction(pool, org, [], true, async (c) => {
			await ready(c);
			const rows = (
				await c.query<{ id: string; reservation_id: string; bytes: number }>(
					"SELECT id,reservation_id,bytes FROM tenancy.files WHERE organization_id=$1 AND expires_at<=clock_timestamp() AND state<>'deleted' ORDER BY expires_at,id LIMIT 2",
					[org],
				)
			).rows;
			for (const file of rows) {
				await storage.clearAttempt(
					`staging/${org}/${file.id}`,
					`quarantine/${org}/${file.id}`,
				);
				await ready(c);
				const reservation = (
					await c.query(
						"SELECT bucket_id,state FROM tenancy.capacity_reservations WHERE organization_id=$1 AND id=$2",
						[org, file.reservation_id],
					)
				).rows[0];
				if (reservation.state === "reserved")
					await settleCapacityReservation(
						c,
						org,
						file.reservation_id,
						"released",
					);
				if (reservation.state === "committed") {
					await c.query(
						"UPDATE tenancy.capacity_buckets SET consumed=consumed-$3 WHERE organization_id=$1 AND id=$2",
						[org, reservation.bucket_id, 2 * file.bytes],
					);
					await c.query(
						"UPDATE tenancy.capacity_reservations SET state='released' WHERE organization_id=$1 AND id=$2",
						[org, file.reservation_id],
					);
				}
				await c.query(
					"UPDATE tenancy.files SET state='deleted',object=NULL,name='[expired]' WHERE organization_id=$1 AND id=$2",
					[org, file.id],
				);
			}
			await ready(c);
		});
	}
}
