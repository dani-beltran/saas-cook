import { readFile } from "node:fs/promises";
import { createAuthorizationService } from "@saas-cook/authz";
import { initializeControlStore } from "@saas-cook/authz/control";
import { runRecovery } from "@saas-cook/authz/recovery";
import { readPlatformCommandEnv } from "@saas-cook/config/server";
import { createAnalyticsService } from "@saas-cook/db/analytics";
import { posthogProvider } from "@saas-cook/db/analytics-provider";
import { analyticsReports } from "@saas-cook/db/analytics-reports";
import { createStripeProvider } from "@saas-cook/db/billing-stripe";
import { configuredFileStorage } from "@saas-cook/db/file-storage";
import { configureFlag } from "@saas-cook/db/flags";
import { createDeletionCleanup } from "@saas-cook/db/lifecycle-cleanup";
import { createRecoveryApplication } from "@saas-cook/db/lifecycle-recovery";
import { Pool } from "pg";

const mode = process.argv[2],
	pools: Pool[] = [];
const arg = (key: string) => {
	const index = process.argv.indexOf(key);
	if (index < 0 || !process.argv[index + 1])
		throw new Error("Missing command argument");
	return process.argv[index + 1];
};
const pool = (url: string | undefined, role: string) => {
	if (!url || new URL(url).username !== role)
		throw new Error("Dedicated command role required");
	const p = new Pool({
		connectionString: url,
		max: 4,
		connectionTimeoutMillis: 5000,
		query_timeout: 10000,
	});
	pools.push(p);
	return p;
};
async function json(path: string) {
	const data = await readFile(path, "utf8");
	if (Buffer.byteLength(data) > 16384)
		throw new Error("Command input too large");
	return data;
}
try {
	if (process.argv.includes("--help"))
		process.stdout.write(
			"control-schema | recovery --approval FILE | recovery-fingerprint | analytics-report --start ISO --end ISO | flags-set --file FILE\nSeparate command credentials required; see docs/phase6/recovery.md.\n",
		);
	else {
		const env = readPlatformCommandEnv();
		let result: unknown;
		if (mode === "control-schema") {
			await initializeControlStore(
				pool(env.CONTROL_ADMIN_DATABASE_URL, "saas_cook_control_admin"),
			);
			result = { initialized: true };
		} else if (mode === "flags-set")
			result = await configureFlag(
				pool(env.PLATFORM_OPERATOR_DATABASE_URL, "saas_cook_platform_operator"),
				JSON.parse(await json(arg("--file"))),
			);
		else if (mode === "analytics-report") {
			const p = pool(
					env.PLATFORM_OPERATOR_DATABASE_URL,
					"saas_cook_platform_operator",
				),
				start = arg("--start"),
				end = arg("--end");
			analyticsReports([], start, end);
			const rows = (
				await p.query("SELECT * FROM foundation.analytics_report_rows($1,$2)", [
					start,
					end,
				])
			).rows;
			result = analyticsReports(
				rows.map((r) => ({ ...r, occurredAt: r.occurred_at.toISOString() })),
				start,
				end,
			);
		} else if (mode === "recovery-fingerprint") {
			const p = pool(env.RECOVERY_DATABASE_URL, "saas_cook_recovery");
			result = (
				await p.query(
					"SELECT foundation.security_fingerprint() AS applicationHash",
				)
			).rows[0];
		} else if (mode === "recovery") {
			if (
				!env.INSTALLATION_ID ||
				!env.OPENFGA_API_URL ||
				!env.RECOVERY_PUBLIC_KEY ||
				!env.AUTH_SECRET
			)
				throw new Error("Recovery configuration required");
			const control = pool(
					env.CONTROL_ADMIN_DATABASE_URL,
					"saas_cook_control_admin",
				),
				application = pool(env.RECOVERY_DATABASE_URL, "saas_cook_recovery");
			const authorization = createAuthorizationService({
				controlPool: control,
				installationId: env.INSTALLATION_ID,
				openfgaUrl: env.OPENFGA_API_URL,
			});
			const analytics = createAnalyticsService(
				application,
				{ authorize: authorization.authorizeResource },
				{
					enabled: false,
					secret: env.AUTH_SECRET,
					synthetic: false,
					ready: authorization.publication,
					provider:
						env.POSTHOG_PERSONAL_KEY &&
						env.POSTHOG_PROJECT_ID &&
						env.POSTHOG_TOKEN
							? posthogProvider({
									host: env.POSTHOG_HOST,
									projectId: env.POSTHOG_PROJECT_ID,
									token: env.POSTHOG_TOKEN,
									personalKey: env.POSTHOG_PERSONAL_KEY,
								})
							: undefined,
					registry: {
						async register() {
							throw new Error("Recovery cannot capture");
						},
						async settle(event) {
							await control.query("SELECT control.settle_analytics($1,$2)", [
								env.INSTALLATION_ID,
								event,
							]);
						},
						async unsettled(subject) {
							return (
								await control.query(
									"SELECT id FROM control.analytics_attempts WHERE installation_id=$1 AND subject_id=$2 AND NOT settled LIMIT 10001",
									[env.INSTALLATION_ID, subject],
								)
							).rows.map((r) => r.id as string);
						},
						async list(kind, id) {
							return (
								await control.query(
									"SELECT id,user_id,organization_id FROM control.analytics_subjects WHERE installation_id=$1 AND (($2='account' AND user_id=$3) OR ($2='organization' AND organization_id::text=$3))",
									[env.INSTALLATION_ID, kind, id],
								)
							).rows;
						},
					},
				},
			);
			const cleanup = createDeletionCleanup(application, {
				analytics,
				storage: configuredFileStorage(env),
				sourceCommit: authorization.sourceCommit,
				billing:
					env.BILLING_ENABLED === "true"
						? createStripeProvider({
								secretKey: env.STRIPE_SECRET_KEY as string,
								accountId: env.STRIPE_ACCOUNT_ID as string,
								mode: env.STRIPE_MODE,
								webhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
								portalConfigurationId:
									env.STRIPE_PORTAL_CONFIGURATION_ID as string,
							})
						: undefined,
			});
			result = await runRecovery({
				control,
				application: createRecoveryApplication(application, cleanup),
				installationId: env.INSTALLATION_ID,
				openfgaUrl: env.OPENFGA_API_URL,
				publicKey: env.RECOVERY_PUBLIC_KEY,
				envelope: await json(arg("--approval")),
			});
		} else throw new Error("Unknown platform command");
		process.stdout.write(`${JSON.stringify(result)}\n`);
	}
} catch {
	process.stderr.write(
		"Platform command failed. Verify scoped credentials, signed evidence, provider receipts and the recovery runbook. Readiness remains closed after a recovery failure.\n",
	);
	process.exitCode = 1;
} finally {
	await Promise.all(pools.map((p) => p.end()));
}
