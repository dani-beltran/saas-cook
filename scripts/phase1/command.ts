import { readMigrationEnv } from "@common-saas/config/server";
import { runMigrations } from "@common-saas/db/migrate";
import { initializeObservability, logEvent } from "@common-saas/observability";
import { PgBoss } from "pg-boss";

const mode = process.argv[2];
const modes = ["migrate", "bootstrap", "authz-publish"];
if (!mode || !modes.includes(mode)) {
	process.stderr.write(
		"Usage: command <migrate|bootstrap|authz-publish> [--help]\n",
	);
	process.exitCode = 2;
} else if (process.argv.includes("--help")) {
	process.stdout.write(
		`${mode}: ${mode === "migrate" ? "Apply reviewed SQL and provision the queue with MIGRATION_DATABASE_URL." : "Reserved Phase 2 command; initialization and graph publication are not implemented in Phase 1."}\n`,
	);
} else if (mode !== "migrate") {
	process.stderr.write(
		`${mode} is unavailable until Phase 2. No readiness or authorization state was changed.\n`,
	);
	process.exitCode = 2;
} else {
	try {
		const env = readMigrationEnv();
		initializeObservability("command");
		await runMigrations({
			databaseUrl: env.MIGRATION_DATABASE_URL,
			migrationsFolder: process.env.MIGRATIONS_DIR,
		});
		const boss = new PgBoss({
			connectionString: env.MIGRATION_DATABASE_URL,
			migrate: true,
			createSchema: false,
			supervise: false,
			schedule: false,
		});
		boss.on("error", () => {
			logEvent("migration.queue_failed");
		});
		try {
			await boss.start();
			await boss.createQueue("runtime-probe", {
				retryLimit: 3,
				retryDelay: 1,
				expireInSeconds: 30,
			});
		} finally {
			await boss.stop();
		}
		logEvent("migration.completed");
	} catch {
		process.stderr.write(
			"Migration failed; verify configuration, database access and migration state.\n",
		);
		process.exitCode = 1;
	}
}
