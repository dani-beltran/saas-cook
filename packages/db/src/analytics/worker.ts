import type { Pool } from "pg";
import { withTenantTransaction } from "../tenancy";
import type { AnalyticsEvent } from "./provider";
import type { createAnalyticsService } from "./service";
export async function collectAnalytics(
	pool: Pool,
	service: ReturnType<typeof createAnalyticsService>,
) {
	await pool.query(
		"DELETE FROM foundation.analytics_sources WHERE occurred_at<clock_timestamp()-interval '24 hours'",
	);
	const rows = (
		await pool.query<{
			id: string;
			user_id: string;
			organization_id: string | null;
			event: AnalyticsEvent["event"];
			feature: AnalyticsEvent["feature"];
			occurred_at: Date;
		}>(
			"SELECT * FROM foundation.analytics_sources ORDER BY occurred_at,id LIMIT 100",
		)
	).rows;
	for (const r of rows)
		await withTenantTransaction(
			pool,
			r.organization_id ?? "00000000-0000-4000-8000-000000000000",
			[r.user_id],
			false,
			async (c) => {
				await service.capture(c, {
					id: r.id,
					user: r.user_id,
					organization: r.organization_id,
					event: r.event,
					feature: r.feature ?? undefined,
					occurredAt: r.occurred_at,
				});
				await c.query("DELETE FROM foundation.analytics_sources WHERE id=$1", [
					r.id,
				]);
			},
			undefined,
			false,
		);
	await pool.query(
		"DELETE FROM foundation.analytics_events WHERE occurred_at<clock_timestamp()-interval '90 days' AND state IN ('delivered','dropped')",
	);
	await pool.query(
		"DELETE FROM foundation.analytics_seen WHERE seen_at<clock_timestamp()-interval '90 days'",
	);
	await service.deliver();
}
