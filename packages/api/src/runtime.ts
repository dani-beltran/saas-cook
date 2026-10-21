import { createIdentityRuntime } from "@saas-cook/auth";
import {
	createApiKeyService,
	createAuthorizationService,
	getPublication,
} from "@saas-cook/authz";
import { readWebEnv } from "@saas-cook/config/server";
import { createBillingService } from "@saas-cook/db/billing";
import { createStripeProvider } from "@saas-cook/db/billing-stripe";
import { acceptStripeWebhook } from "@saas-cook/db/billing-worker";
import { createExampleCustomersService } from "@saas-cook/db/example-customers";
import { configuredFileStorage } from "@saas-cook/db/file-storage";
import { createFileService } from "@saas-cook/db/files";
import { createPlatformService } from "@saas-cook/db/platform";
import { createResourceService } from "@saas-cook/db/resources";
import { createTenancyService } from "@saas-cook/db/tenancy";
import { enqueueIdentityEmail } from "@saas-cook/email";
import { getOperationContext } from "@saas-cook/observability";
import { Pool } from "pg";
import { createPlatformRuntime } from "./platform-runtime";

function createRuntime() {
	const env = readWebEnv();
	const pool = (connectionString: string) =>
		new Pool({
			connectionString,
			max: 8,
			connectionTimeoutMillis: 3000,
			query_timeout: 8000,
		});
	const applicationPool = pool(env.DATABASE_URL);
	const identityPool = pool(env.IDENTITY_DATABASE_URL);
	const controlPool = pool(env.CONTROL_DATABASE_URL);
	const readiness = () => getPublication(controlPool, env.INSTALLATION_ID);
	const identity = createIdentityRuntime(identityPool, {
		origin: env.APP_ORIGIN,
		secret: env.AUTH_SECRET,
		trustedIngressSecret: env.AUTH_INGRESS_SECRET,
		readiness,
	});
	const authorization = createAuthorizationService({
		controlPool,
		installationId: env.INSTALLATION_ID,
		openfgaUrl: env.OPENFGA_API_URL,
	});
	const tenancy = createTenancyService(applicationPool, {
		...authorization,
		correlation: getOperationContext,
		async notify(client, notification) {
			const url = new URL(
				`/en/organizations/${notification.organizationId}`,
				env.APP_ORIGIN,
			);
			if (notification.kind === "invite" && notification.token)
				url.searchParams.set("invite", notification.token);
			if (notification.kind === "transfer")
				url.searchParams.set("transfer", notification.referenceId);
			await enqueueIdentityEmail(client, {
				secret: env.AUTH_SECRET,
				to: notification.email,
				kind: notification.kind,
				locale: "en",
				url: url.href,
				expiresAt: notification.expiresAt,
			});
		},
	});
	const provider =
		env.BILLING_ENABLED === "true"
			? createStripeProvider({
					secretKey: env.STRIPE_SECRET_KEY as string,
					accountId: env.STRIPE_ACCOUNT_ID as string,
					mode: env.STRIPE_MODE,
					webhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
					portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID as string,
				})
			: undefined;
	const billing = createBillingService(applicationPool, authorization, {
		provider,
		origin: env.APP_ORIGIN,
		defaultProjectCreatesPerMonth:
			env.DEFAULT_PROJECT_CREATES_PER_MONTH === "unlimited"
				? null
				: env.DEFAULT_PROJECT_CREATES_PER_MONTH,
	});
	const resources = createResourceService(
		applicationPool,
		{
			authorize: authorization.authorizeResource,
			check: authorization.checkResource,
			checkBatch: authorization.checkResourceBatch,
			sourceCommit: authorization.sourceCommit,
			correlation: getOperationContext,
		},
		{
			cursorSecret: env.AUTH_SECRET,
			defaultProjectCreatesPerMonth:
				env.DEFAULT_PROJECT_CREATES_PER_MONTH === "unlimited"
					? null
					: env.DEFAULT_PROJECT_CREATES_PER_MONTH,
			usageThresholds: env.USAGE_NOTICE_THRESHOLDS,
			defaultProjectCapacity:
				env.DEFAULT_PROJECT_CAPACITY === "unlimited"
					? null
					: env.DEFAULT_PROJECT_CAPACITY,
		},
	);
	const platformModules = createPlatformRuntime(
		env,
		applicationPool,
		controlPool,
		identity.backgroundActor,
	);
	const keys = createApiKeyService({ pool: applicationPool, authorization });
	return {
		platformModules,
		feedbackSecret: env.OPTIONAL_EMAIL_FEEDBACK_SECRET,
		files: createFileService(
			applicationPool,
			{ authorize: authorization.authorizeResource },
			{
				storage: configuredFileStorage(env),
				capacityBytes: env.FILES_CAPACITY_BYTES,
			},
		),
		platform: createPlatformService(
			applicationPool,
			{
				authorize: authorization.authorizeResource,
				check: authorization.checkResource,
			},
			{ cursorSecret: env.AUTH_SECRET },
		),
		billing,
		async webhook(raw: Buffer, signature: string) {
			if (!provider) throw new Error("Billing disabled");
			return acceptStripeWebhook(applicationPool, provider, raw, signature);
		},
		exampleCustomers: createExampleCustomersService(
			applicationPool,
			{
				authorize: authorization.authorizeResource,
				correlation: getOperationContext,
			},
			{ cursorSecret: env.AUTH_SECRET },
		),
		resources,
		keys,
		identity,
		tenancy,
		origin: env.APP_ORIGIN,
		async close() {
			await Promise.all([
				platformModules?.close(),
				applicationPool.end(),
				identityPool.end(),
				controlPool.end(),
			]);
		},
		async ready() {
			const publication = await readiness();
			const binding = await applicationPool.query(
				"SELECT 1 FROM foundation.installation WHERE installation_id=$1 AND binding_id=$2 AND recovery_epoch=$3",
				[publication.installationId, publication.bindingId, publication.epoch],
			);
			if (binding.rowCount !== 1)
				throw new Error("Application readiness required");
		},
	};
}
let runtime: ReturnType<typeof createRuntime> | undefined;
/** Lazy construction keeps builds independent of credentials and live services. */
export function applicationRuntime() {
	runtime ??= createRuntime();
	return runtime;
}

/** Internal command/test lifecycle: release pools before removing a disposable installation. */
export async function shutdownApplicationRuntime() {
	const current = runtime;
	runtime = undefined;
	await current?.close();
}

export type { PersonalSettings } from "@saas-cook/auth";
