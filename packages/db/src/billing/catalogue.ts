import type { Pool } from "pg";
import { z } from "zod";
import { BillingError, planSchema } from "./policy";

const catalogue = z.strictObject({
	environment: z.string().regex(/^(test|live):acct_[A-Za-z0-9]+$/),
	plans: z
		.array(
			z.strictObject({
				plan: planSchema,
				price: z
					.strictObject({
						id: z.string().regex(/^price_[A-Za-z0-9_]+$/),
						currency: z.string().regex(/^[a-z]{3}$/),
						amount: z.number().int().min(0).max(100000000),
						interval: z.enum(["month", "year"]),
					})
					.optional(),
			}),
		)
		.min(1)
		.max(100),
});
/** Explicit migrator-only import. Sold definitions and environment mappings can only be appended. */
export async function installBillingCatalogue(pool: Pool, input: unknown) {
	const data = catalogue.parse(input),
		c = await pool.connect();
	try {
		await c.query("BEGIN");
		if (
			(await c.query<{ current_user: string }>("SELECT current_user")).rows[0]
				.current_user !== "saas_cook_migrator"
		)
			throw new BillingError("DENIED");
		await c.query("SELECT pg_advisory_xact_lock(1849202605)");
		for (const { plan, price } of data.plans) {
			const old = (
				await c.query<{ same: boolean }>(
					"SELECT definition=$2::jsonb AS same FROM foundation.plan_versions WHERE id=$1",
					[plan.id, JSON.stringify(plan)],
				)
			).rows[0];
			if (old && !old.same) throw new BillingError("CONFLICT");
			if (!old)
				await c.query(
					"INSERT INTO foundation.plan_versions(id,plan_key,version,definition) VALUES($1,$2,$3,$4)",
					[plan.id, plan.key, plan.version, JSON.stringify(plan)],
				);
			if (price) {
				if (plan.mode === "free") throw new BillingError("INVALID");
				const existing = (
					await c.query<{
						plan_version_id: string;
						currency: string;
						amount: number;
						interval: string;
					}>(
						"SELECT * FROM foundation.billing_prices WHERE environment=$1 AND price_id=$2",
						[data.environment, price.id],
					)
				).rows[0];
				if (
					existing &&
					(existing.plan_version_id !== plan.id ||
						existing.currency !== price.currency ||
						existing.amount !== price.amount ||
						existing.interval !== price.interval)
				)
					throw new BillingError("CONFLICT");
				if (!existing)
					await c.query(
						"INSERT INTO foundation.billing_prices(environment,price_id,plan_version_id,currency,amount,interval) VALUES($1,$2,$3,$4,$5,$6)",
						[
							data.environment,
							price.id,
							plan.id,
							price.currency,
							price.amount,
							price.interval,
						],
					);
			}
		}
		await c.query("COMMIT");
		return {
			environment: data.environment,
			versions: data.plans.map((p) => p.plan.id),
		};
	} catch (e) {
		await c.query("ROLLBACK").catch(() => {});
		throw e;
	} finally {
		c.release();
	}
}
