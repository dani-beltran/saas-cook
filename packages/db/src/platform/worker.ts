import type { Pool, PoolClient } from "pg";
import { withTenantTransaction } from "../tenancy";
/** Bounded projection cleanup. Audit retention uses its separate authority. */
export async function pruneActivity(
	pool: Pool,
	ready: (client: PoolClient) => Promise<unknown>,
) {
	const organizations = (
		await pool.query<{ organization_id: string }>(
			"SELECT organization_id FROM tenancy.activity_retention_due()",
		)
	).rows;
	for (const { organization_id: org } of organizations) {
		await withTenantTransaction(
			pool,
			org,
			[],
			false,
			async (c) => {
				await ready(c);
				await c.query(
					"DELETE FROM tenancy.activity_events WHERE organization_id=$1 AND source_id IN (SELECT source_id FROM tenancy.activity_events WHERE organization_id=$1 AND occurred_at<=clock_timestamp()-interval '90 days' ORDER BY occurred_at,source_id LIMIT 1000)",
					[org],
				);
				await ready(c);
			},
			undefined,
			false,
		);
	}
}
