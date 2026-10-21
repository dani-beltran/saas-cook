import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
export const flagConfiguration = z.strictObject({
	key: z.enum(["help.contact"]),
	owner: z.string().min(1).max(120),
	enabled: z.boolean(),
	percent: z.number().int().min(0).max(100),
	organizations: z.array(z.uuid()).max(100),
	excluded: z.array(z.uuid()).max(100),
	environment: z.enum(["development", "test", "production"]),
	expiresAt: z.iso.datetime(),
	version: z.number().int().min(0),
});
export function evaluateFlag(
	config: z.infer<typeof flagConfiguration> | null,
	key: string,
	organization: string,
	environment: string,
	now = new Date(),
) {
	if (
		!config ||
		config.key !== key ||
		config.environment !== environment ||
		!config.enabled ||
		Date.parse(config.expiresAt) <= now.getTime() ||
		config.excluded.includes(organization)
	)
		return false;
	return (
		config.organizations.includes(organization) ||
		createHash("sha256")
			.update(`${key}:${organization}`)
			.digest()
			.readUInt32BE(0) %
			10000 <
			config.percent * 100
	);
}
/** Flags can restrict presentation/work, never grant authorization or paid entitlements. */
export async function readFlag(
	pool: Pool,
	key: string,
	organization: string,
	environment: string,
) {
	const r = (
		await pool.query("SELECT * FROM foundation.rollout_flags WHERE key=$1", [
			key,
		])
	).rows[0];
	return evaluateFlag(
		r ? { ...r, expiresAt: r.expires_at.toISOString() } : null,
		key,
		organization,
		environment,
	);
}
export async function configureFlag(pool: Pool, raw: unknown) {
	const i = flagConfiguration.parse(raw);
	if (
		Date.parse(i.expiresAt) <= Date.now() ||
		Date.parse(i.expiresAt) > Date.now() + 90 * 86400000
	)
		throw new Error("Flag expiry must be within 90 days");
	const c = await pool.connect();
	try {
		if (
			(await c.query("SELECT current_user")).rows[0].current_user !==
			"saas_cook_platform_operator"
		)
			throw new Error("Dedicated platform operator required");
		await c.query("BEGIN");
		await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
			`flag:${i.key}`,
		]);
		const old = (
			await c.query(
				"SELECT version FROM foundation.rollout_flags WHERE key=$1",
				[i.key],
			)
		).rows[0];
		if ((old?.version ?? 0) !== i.version)
			throw new Error("Flag version conflict");
		const next = { ...i, version: i.version + 1 };
		await c.query(
			"INSERT INTO foundation.rollout_flags(key,owner,enabled,percent,organizations,excluded,environment,expires_at,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(key) DO UPDATE SET owner=$2,enabled=$3,percent=$4,organizations=$5,excluded=$6,environment=$7,expires_at=$8,version=$9",
			[
				i.key,
				i.owner,
				i.enabled,
				i.percent,
				JSON.stringify(i.organizations),
				JSON.stringify(i.excluded),
				i.environment,
				i.expiresAt,
				next.version,
			],
		);
		await c.query(
			"INSERT INTO foundation.rollout_history(id,key,version,configuration) VALUES($1,$2,$3,$4)",
			[randomUUID(), i.key, next.version, JSON.stringify(next)],
		);
		await c.query("COMMIT");
		return next;
	} catch (e) {
		await c.query("ROLLBACK");
		throw e;
	} finally {
		c.release();
	}
}
