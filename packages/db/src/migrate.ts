import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";

/**
 * Apply reviewed migrations under the dedicated migrator role and advisory lock.
 * Accepts a database URL and optional fixture migration directory. Existing applied
 * hashes/timestamps must be an exact prefix of local history; changed, missing or
 * future migrations and unordered local timestamps reject before DDL. Runtime
 * processes must never call this. Resolves only after the complete applied history
 * matches local history and always closes its pool. SQL/history errors propagate;
 * a postcondition failure may follow committed DDL and requires forward repair.
 */
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
		if (role.rows[0]?.current_user !== "saas_cook_migrator")
			throw new Error(
				"Migrations require the dedicated saas_cook_migrator role",
			);
		// A bounded lock prevents competing deployment commands from applying DDL.
		await client.query("SET lock_timeout = '30s'");
		await client.query("SELECT pg_advisory_lock(1849202601)");
		const migrationsFolder =
			options.migrationsFolder ??
			fileURLToPath(new URL("../migrations", import.meta.url));
		const expected = readMigrationFiles({ migrationsFolder });
		if (
			expected.some(
				(migration, index) =>
					!Number.isSafeInteger(migration.folderMillis) ||
					migration.folderMillis < 0 ||
					(index > 0 &&
						migration.folderMillis <= expected[index - 1].folderMillis),
			)
		)
			throw new Error(
				"Local migration journal timestamps must be nonnegative safe integers in strictly increasing order",
			);
		const exists = await client.query(
			"SELECT to_regclass('drizzle.__drizzle_migrations') AS name",
		);
		if (exists.rows[0]?.name) {
			const applied = await client.query<{ hash: string; created_at: string }>(
				"SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
			);
			if (
				applied.rows.length > expected.length ||
				applied.rows.some(
					(row, index) =>
						row.hash !== expected[index]?.hash ||
						Number(row.created_at) !== expected[index]?.folderMillis,
				)
			)
				throw new Error(
					"Applied migration history is incompatible with this release; use the matching image or forward repair",
				);
		}
		await migrate(drizzle(client), {
			migrationsFolder,
		});
		const completed = await client.query<{ hash: string; created_at: string }>(
			"SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
		);
		if (
			completed.rows.length !== expected.length ||
			completed.rows.some(
				(row, index) =>
					row.hash !== expected[index]?.hash ||
					Number(row.created_at) !== expected[index]?.folderMillis,
			)
		)
			throw new Error(
				"Migration completed without the exact expected history; inspect committed changes and use forward repair",
			);
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
