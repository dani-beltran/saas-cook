import {
	bootstrap,
	publishAuthorization,
	upgradeAuthorization,
} from "@common-saas/authz/commands";
import {
	readAuthorizationCommandEnv,
	readMigrationEnv,
	readOperatorCommandEnv,
} from "@common-saas/config/server";
import { runMigrations } from "@common-saas/db/migrate";
import { enqueueIdentityEmail } from "@common-saas/email";
import { initializeObservability, logEvent } from "@common-saas/observability";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { runOwnerCommand } from "../phase2/owner-command";

const mode = process.argv[2];
const modes = [
	"migrate",
	"bootstrap",
	"authz-publish",
	"authz-upgrade",
	"owner-recovery",
	"security-deactivate",
];
if (!mode || !modes.includes(mode)) {
	process.stderr.write(
		"Usage: command <migrate|bootstrap|authz-publish|authz-upgrade|owner-recovery|security-deactivate> [--approval path] [--help]\n",
	);
	process.exitCode = 2;
} else if (process.argv.includes("--help")) {
	process.stdout.write(
		`${mode}: ${mode === "migrate" ? "Apply reviewed SQL and provision the queue with MIGRATION_DATABASE_URL." : "Validate the independent installation epoch and pinned authorization model using dedicated command credentials. Bootstrap initializes a fresh installation, resumes interrupted initialization, or reports an already completed matching installation."}\n`,
	);
} else if (mode === "owner-recovery" || mode === "security-deactivate") {
	let applicationPool: Pool | undefined;
	let controlPool: Pool | undefined;
	try {
		const env = readOperatorCommandEnv();
		const approvalFile = process.argv[process.argv.indexOf("--approval") + 1];
		if (!process.argv.includes("--approval") || !approvalFile)
			throw new Error("Signed approval file required");
		applicationPool = new Pool({
			connectionString: env.DATABASE_URL,
			max: 2,
			connectionTimeoutMillis: 5000,
		});
		controlPool = new Pool({
			connectionString: env.CONTROL_ADMIN_DATABASE_URL,
			max: 2,
			connectionTimeoutMillis: 5000,
		});
		await runOwnerCommand({
			mode,
			approvalFile,
			publicKey: env.OWNER_RECOVERY_PUBLIC_KEY,
			applicationPool,
			controlPool,
			installationId: env.INSTALLATION_ID,
			openfgaUrl: env.OPENFGA_API_URL,
			async notify(client, notification) {
				await enqueueIdentityEmail(client, {
					secret: env.AUTH_SECRET,
					to: notification.email,
					kind: notification.kind,
					locale: "en",
					url: new URL(
						`/en/organizations/${notification.organizationId}`,
						env.APP_ORIGIN,
					).href,
					expiresAt: notification.expiresAt,
				});
			},
		});
		process.stdout.write(`${mode} completed.\n`);
	} catch {
		process.stderr.write(
			`${mode} failed; verify the signed independent approval, fresh MFA, capacity and authorization readiness.\n`,
		);
		process.exitCode = 1;
	} finally {
		await Promise.all([applicationPool?.end(), controlPool?.end()]);
	}
} else if (mode !== "migrate") {
	let applicationPool: Pool | undefined;
	let controlPool: Pool | undefined;
	try {
		const env = readAuthorizationCommandEnv();
		applicationPool = new Pool({
			connectionString: env.MIGRATION_DATABASE_URL,
			max: 1,
			connectionTimeoutMillis: 5000,
		});
		controlPool = new Pool({
			connectionString: env.CONTROL_ADMIN_DATABASE_URL,
			max: 2,
			connectionTimeoutMillis: 5000,
		});
		const command =
			mode === "bootstrap"
				? bootstrap
				: mode === "authz-upgrade"
					? upgradeAuthorization
					: publishAuthorization;
		const result = await command({
			applicationPool,
			controlPool,
			installationId: env.INSTALLATION_ID,
			openfgaUrl: env.OPENFGA_API_URL,
		});
		process.stdout.write(
			result === "already-completed"
				? "Bootstrap already completed successfully; nothing to do.\n"
				: `${mode} completed.\n`,
		);
	} catch {
		process.stderr.write(
			`${mode} failed; verify independent readiness, configuration and initialization state. Existing or restored data cannot be initialized as fresh.\n`,
		);
		process.exitCode = 1;
	} finally {
		await Promise.all([applicationPool?.end(), controlPool?.end()]);
	}
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
