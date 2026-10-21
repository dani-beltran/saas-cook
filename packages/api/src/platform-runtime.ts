import { createAuthorizationService } from "@saas-cook/authz";
import { appendDeletion } from "@saas-cook/authz/journal";
import type { readWebEnv, readWorkerEnv } from "@saas-cook/config/server";
import { createAnalyticsService } from "@saas-cook/db/analytics";
import { posthogProvider } from "@saas-cook/db/analytics-provider";
import { collectAnalytics } from "@saas-cook/db/analytics-worker";
import { createStripeProvider } from "@saas-cook/db/billing-stripe";
import { createBulkService } from "@saas-cook/db/bulk";
import { httpsEndpointTransport } from "@saas-cook/db/endpoint-transport";
import { configuredFileStorage } from "@saas-cook/db/file-storage";
import { createFileService } from "@saas-cook/db/files";
import { readFlag } from "@saas-cook/db/flags";
import {
	advanceDeletion,
	createLifecycleService,
} from "@saas-cook/db/lifecycle";
import { createDeletionCleanup } from "@saas-cook/db/lifecycle-cleanup";
import { createNotifications } from "@saas-cook/db/notifications";
import { createResourceService } from "@saas-cook/db/resources";
import { createSettingsService } from "@saas-cook/db/settings";
import { type TenantActor, withTenantTransaction } from "@saas-cook/db/tenancy";
import { Pool } from "pg";
/**
 * Creates opt-in domain services and coordinates their restricted database pools and worker consumers.
 * @param env - Validated platform configuration; PLATFORM_ENABLED=false disables these services.
 * @param pool - Restricted application pool used for ordinary tenant operations.
 * @param control - Independent control-reader pool used for current readiness and retained receipts.
 * @param resolveActor - Resolves a queued job's current session assurance before effects.
 * @param send - Optional worker email transport; web processes do not supply one.
 * @returns Domain services, tick and close methods, or undefined when disabled. Call close on shutdown.
 * Database/provider errors propagate from service calls; tick reports pending work after isolating consumers.
 */
export function createPlatformRuntime(
	env: ReturnType<typeof readWebEnv> | ReturnType<typeof readWorkerEnv>,
	pool: Pool,
	control: Pool,
	resolveActor: Parameters<typeof createBulkService>[2]["resolveActor"],
	send?: Parameters<typeof createNotifications>[2]["send"],
) {
	if (env.PLATFORM_ENABLED !== "true") return;
	const lifecyclePool = new Pool({
			connectionString: env.LIFECYCLE_DATABASE_URL,
			max: 6,
			connectionTimeoutMillis: 3000,
			query_timeout: 10000,
		}),
		writer = new Pool({
			connectionString: env.JOURNAL_DATABASE_URL,
			max: 2,
			connectionTimeoutMillis: 3000,
			query_timeout: 5000,
		});
	const auth = createAuthorizationService({
		controlPool: control,
		installationId: env.INSTALLATION_ID,
		openfgaUrl: env.OPENFGA_API_URL,
	});
	const hooks = {
		authorize: auth.authorizeResource,
		check: auth.checkResource,
		checkBatch: auth.checkResourceBatch,
		sourceCommit: auth.sourceCommit,
	};
	const storage = configuredFileStorage(env);
	const files = createFileService(pool, hooks, {
		storage,
		capacityBytes: env.FILES_CAPACITY_BYTES,
	});
	const resources = createResourceService(pool, hooks, {
		cursorSecret: env.AUTH_SECRET,
		defaultProjectCapacity:
			env.DEFAULT_PROJECT_CAPACITY === "unlimited"
				? null
				: env.DEFAULT_PROJECT_CAPACITY,
		defaultProjectCreatesPerMonth:
			env.DEFAULT_PROJECT_CREATES_PER_MONTH === "unlimited"
				? null
				: env.DEFAULT_PROJECT_CREATES_PER_MONTH,
		usageThresholds: env.USAGE_NOTICE_THRESHOLDS,
	});
	const settings = createSettingsService(pool, hooks, {
		secret: env.AUTH_SECRET,
		allowedHosts: env.OUTGOING_ALLOWED_HOSTS,
		transport: httpsEndpointTransport(env.OUTGOING_ALLOWED_HOSTS),
		ready: auth.publication,
	});
	const analytics = createAnalyticsService(lifecyclePool, hooks, {
		enabled: env.ANALYTICS_ENABLED === "true",
		secret: env.AUTH_SECRET,
		synthetic: env.APP_ENV !== "production",
		ready: auth.publication,
		provider:
			env.POSTHOG_PROJECT_ID && env.POSTHOG_TOKEN && env.POSTHOG_PERSONAL_KEY
				? posthogProvider({
						host: env.POSTHOG_HOST,
						projectId: env.POSTHOG_PROJECT_ID as string,
						token: env.POSTHOG_TOKEN as string,
						personalKey: env.POSTHOG_PERSONAL_KEY as string,
					})
				: undefined,
		registry: {
			async register(id, user, org, event) {
				await writer.query("SELECT control.begin_analytics($1,$2,$3,$4,$5)", [
					env.INSTALLATION_ID,
					id,
					user,
					org,
					event,
				]);
			},
			async settle(event) {
				await writer.query("SELECT control.settle_analytics($1,$2)", [
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
	});
	const journal = {
		append: (key: string, record: Parameters<typeof appendDeletion>[3]) =>
			appendDeletion(writer, env.INSTALLATION_ID, key, record),
	};
	const lifecycle = createLifecycleService(lifecyclePool, hooks, {
		secret: env.AUTH_SECRET,
		journal,
	});
	const cleanup = createDeletionCleanup(lifecyclePool, {
		storage,
		analytics,
		sourceCommit: auth.sourceCommit,
		billing:
			env.BILLING_ENABLED === "true"
				? createStripeProvider({
						secretKey: env.STRIPE_SECRET_KEY as string,
						accountId: env.STRIPE_ACCOUNT_ID as string,
						mode: env.STRIPE_MODE,
						webhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
						portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID as string,
					})
				: undefined,
	});
	const bulk = createBulkService(pool, hooks, {
		secret: env.AUTH_SECRET,
		files,
		resources,
		storage,
		resolveActor,
		ready: auth.publication,
		auditExport: settings.auditExport,
	});
	const notifications = createNotifications(lifecyclePool, hooks, {
		secret: env.AUTH_SECRET,
		ready: auth.publication,
		send,
	});
	return {
		dataJobs: bulk,
		organizationSettings: settings,
		analytics,
		privacy: lifecycle,
		notifications,
		cleanup,
		async flags(a: TenantActor, org: string) {
			return withTenantTransaction(
				pool,
				org,
				[a.userId],
				false,
				async (c) => {
					await hooks.authorize(
						c,
						a,
						org,
						{ type: "organization", id: org },
						"read",
					);
					return {
						helpContact: await readFlag(pool, "help.contact", org, env.APP_ENV),
					};
				},
				undefined,
				false,
			);
		},
		async tick() {
			// Each bounded consumer has its own error boundary so provider outages do not starve unrelated work.
			const tasks = [
				async () => {
					for (const r of (
						await lifecyclePool.query(
							"SELECT id,state FROM foundation.deletion_requests WHERE state IN ('journal_pending','scheduled','purging') ORDER BY created_at LIMIT 5",
						)
					).rows) {
						if (r.state === "journal_pending")
							await lifecycle.acknowledge(r.id);
						else await advanceDeletion(lifecyclePool, journal, cleanup, r.id);
					}
				},
				async () => {
					for (const r of (await pool.query("SELECT * FROM tenancy.bulk_due()"))
						.rows)
						await bulk.run(r.organization_id, r.id);
				},
				async () => {
					for (const r of (
						await pool.query("SELECT * FROM tenancy.platform_delivery_due()")
					).rows) {
						await settings.deliverWebhooks(r.organization_id);
						await notifications.deliver(r.organization_id);
					}
				},
				() => collectAnalytics(lifecyclePool, analytics),
			];
			const results = await Promise.allSettled(tasks.map((t) => t()));
			if (results.some((r) => r.status === "rejected"))
				throw new Error("Platform work pending");
		},
		async close() {
			await Promise.all([lifecyclePool.end(), writer.end()]);
		},
	};
}
