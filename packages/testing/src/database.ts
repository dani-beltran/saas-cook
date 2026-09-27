import { setTimeout } from "node:timers/promises";
import type { Pool } from "pg";

/** Drop only a generated disposable database, after its clients have disconnected. */
export async function dropTestDatabase(admin: Pool, name: string) {
	if (!/^[a-z][a-z0-9_]{0,29}_[a-f0-9]{32}$/.test(name))
		throw new Error("Expected a generated test database name");
	// pg Pool.end() can resolve before PostgreSQL observes every socket closing.
	// FORCE races those sockets and emits unhandled 57P01 errors in the test process.
	const deadline = performance.now() + 5_000;
	while (true) {
		const result = await admin.query(
			"SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname=$1",
			[name],
		);
		if (result.rows[0].connections === 0) break;
		if (performance.now() >= deadline)
			throw new Error("Disposable database still has open connections");
		await setTimeout(10);
	}
	// A leaked/reconnecting client must fail cleanup rather than be force-killed.
	await admin.query(`DROP DATABASE IF EXISTS ${name}`);
}
