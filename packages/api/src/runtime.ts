import { createIdentityRuntime } from "@common-saas/auth";
import {
	createApiKeyService,
	createAuthorizationService,
	getPublication,
} from "@common-saas/authz";
import { readWebEnv } from "@common-saas/config/server";
import { createResourceService } from "@common-saas/db/resources";
import { createTenancyService } from "@common-saas/db/tenancy";
import { enqueueIdentityEmail } from "@common-saas/email";
import { getOperationContext } from "@common-saas/observability";
import { Pool } from "pg";

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
			workspacesEnabled: env.WORKSPACES_ENABLED === "true",
			defaultProjectCapacity:
				env.DEFAULT_PROJECT_CAPACITY === "unlimited"
					? null
					: env.DEFAULT_PROJECT_CAPACITY,
		},
	);
	const keys = createApiKeyService({ pool: applicationPool, authorization });
	return {
		resources,
		keys,
		identity,
		tenancy,
		origin: env.APP_ORIGIN,
		async close() {
			await Promise.all([
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
