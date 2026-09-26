import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDatabase(databaseUrl: string) {
	const pool = new Pool({
		connectionString: databaseUrl,
		max: 5,
		connectionTimeoutMillis: 5_000,
		statement_timeout: 5_000,
	});
	return { pool, db: drizzle(pool, { schema }) };
}
/** Checks the application schema as well as connectivity; an unmigrated DB is unready. */
export async function checkDatabase(databaseUrl: string): Promise<void> {
	const { pool } = createDatabase(databaseUrl);
	try {
		await pool.query(
			"SELECT process FROM foundation.runtime_heartbeats LIMIT 0",
		);
	} finally {
		await pool.end();
	}
}
export async function recordHeartbeat(
	pool: Pool,
	processName: string,
): Promise<void> {
	await pool.query(
		`INSERT INTO foundation.runtime_heartbeats (process, observed_at) VALUES ($1, clock_timestamp())
    ON CONFLICT (process) DO UPDATE SET observed_at = excluded.observed_at`,
		[processName],
	);
}
export async function readHeartbeat(
	pool: Pool,
	processName: string,
): Promise<Date | null> {
	const result = await pool.query<{ observed_at: Date }>(
		"SELECT observed_at FROM foundation.runtime_heartbeats WHERE process = $1",
		[processName],
	);
	return result.rows[0]?.observed_at ?? null;
}
/** Durable receipt makes the synthetic queue consumer idempotent across redelivery. */
export async function recordProbe(pool: Pool, id: string): Promise<void> {
	await pool.query(
		"INSERT INTO foundation.runtime_probes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
		[id],
	);
}
export async function hasProbe(pool: Pool, id: string): Promise<boolean> {
	const result = await pool.query(
		"SELECT 1 FROM foundation.runtime_probes WHERE id = $1",
		[id],
	);
	return result.rowCount === 1;
}
