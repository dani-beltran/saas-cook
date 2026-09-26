import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";

/** Explicit one-off command only. Runtime processes never run DDL. */
export async function runMigrations(options: {
	databaseUrl: string;
	migrationsFolder?: string;
}): Promise<void> {
	const pool = new Pool({
		connectionString: options.databaseUrl,
		max: 1,
		connectionTimeoutMillis: 5_000,
	});
	let client: PoolClient | undefined;
	try {
		client = await pool.connect();
		const role = await client.query<{ current_user: string }>(
			"SELECT current_user",
		);
		if (role.rows[0]?.current_user !== "common_saas_migrator")
			throw new Error(
				"Migrations require the dedicated common_saas_migrator role",
			);
		// A bounded lock prevents competing deployment commands from applying DDL.
		await client.query("SET lock_timeout = '30s'");
		await client.query("SELECT pg_advisory_lock(1849202601)");
		await migrate(drizzle(client), {
			migrationsFolder:
				options.migrationsFolder ??
				fileURLToPath(new URL("../migrations", import.meta.url)),
		});
	} finally {
		if (client) {
			await client
				.query("SELECT pg_advisory_unlock(1849202601)")
				.catch(() => {});
			client.release();
		}
		await pool.end();
	}
}
