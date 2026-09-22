import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
it.skipIf(process.env.PHASE0_INTEGRATION !== "1")(
	"Drizzle preserves the connection-bound tenant transaction",
	async () => {
		const admin = new Pool({
			connectionString:
				process.env.PHASE0_DATABASE_URL ??
				"postgres://postgres:phase0@127.0.0.1:55432/phase0",
		});
		try {
			await admin.query(
				await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
			);
		} finally {
			await admin.end();
		}
		const url = new URL(
			process.env.PHASE0_DATABASE_URL ??
				"postgres://postgres:phase0@127.0.0.1:55432/phase0",
		);
		url.username = "phase0_runtime";
		url.password = "phase0-runtime";
		const pool = new Pool({ connectionString: url.toString(), max: 1 });
		try {
			const db = drizzle(pool);
			await db.transaction(async (tx) => {
				await tx.execute(
					sql`SELECT set_config('app.organization_id', '00000000-0000-4000-8000-000000000001', true)`,
				);
				const result = await tx.execute(
					sql`SELECT current_user AS role, current_setting('app.organization_id') AS organization`,
				);
				expect(result.rows[0]).toEqual({
					role: "phase0_runtime",
					organization: "00000000-0000-4000-8000-000000000001",
				});
			});
			const result = await db.execute(
				sql`SELECT NULLIF(current_setting('app.organization_id', true),'') AS organization`,
			);
			expect(result.rows[0]).toEqual({ organization: null });
		} finally {
			await pool.end();
		}
	},
);
