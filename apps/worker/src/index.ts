import { rename, rm, writeFile } from "node:fs/promises";
import { createPlatformRuntime } from "@saas-cook/api/platform-runtime";
import { createAuthorizationService, getPublication } from "@saas-cook/authz";
import { readWorkerEnv } from "@saas-cook/config/server";
import { recordHeartbeat, recordProbe } from "@saas-cook/db";
import { createStripeProvider } from "@saas-cook/db/billing-stripe";
import { createBillingWorker } from "@saas-cook/db/billing-worker";
import { backgroundActors } from "@saas-cook/db/bulk-actor";
import { configuredFileStorage } from "@saas-cook/db/file-storage";
import { pruneFiles } from "@saas-cook/db/files-worker";
import { pruneActivity } from "@saas-cook/db/platform-worker";
import {
	createSmtpTransport,
	deliverBillingNotices,
	deliverIdentityEmails,
	renderOptionalEmail,
} from "@saas-cook/email";
import {
	initializeObservability,
	logEvent,
	shutdownObservability,
	withOperation,
} from "@saas-cook/observability";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { workerFailureStatus } from "./diagnostics";

const env = readWorkerEnv();
initializeObservability("worker");
const pool = new Pool({
	connectionString: env.WORKER_DATABASE_URL,
	max: 8,
	connectionTimeoutMillis: 3000,
	query_timeout: 3000,
});
const controlPool = new Pool({
	connectionString: env.CONTROL_DATABASE_URL,
	max: 2,
	connectionTimeoutMillis: 3000,
	query_timeout: 3000,
});
const authorization = createAuthorizationService({
	controlPool,
	installationId: env.INSTALLATION_ID,
	openfgaUrl: env.OPENFGA_API_URL,
});
const billingWorker =
	env.BILLING_ENABLED === "true"
		? createBillingWorker(pool, authorization, {
				provider: createStripeProvider({
					secretKey: env.STRIPE_SECRET_KEY as string,
					accountId: env.STRIPE_ACCOUNT_ID as string,
					mode: env.STRIPE_MODE,
					webhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
					portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID as string,
				}),
				origin: env.APP_ORIGIN,
			})
		: undefined;
const fileStorage = configuredFileStorage(env);
const mailTransport = createSmtpTransport({
	host: env.SMTP_HOST,
	port: env.SMTP_PORT,
	from: env.SMTP_FROM,
	secure: env.SMTP_SECURE === "true",
	username: env.SMTP_USERNAME,
	password: env.SMTP_PASSWORD,
});
const completion = createPlatformRuntime(
	env,
	pool,
	controlPool,
	backgroundActors(pool, () =>
		getPublication(controlPool, env.INSTALLATION_ID),
	),
	async (m) => {
		const content = await renderOptionalEmail({
			locale: m.locale,
			url: new URL(
				`/${m.locale}/organizations/${m.organizationId}/data`,
				env.APP_ORIGIN,
			).href,
			unsubscribeUrl: new URL(
				`/${m.locale}/unsubscribe#${m.unsubscribe}`,
				env.APP_ORIGIN,
			).href,
		});
		await mailTransport({ id: m.id, to: m.to, ...content });
	},
);
let completionTimer: NodeJS.Timeout | undefined,
	pendingCompletion: Promise<void> | undefined;
async function ready() {
	const publication = await getPublication(controlPool, env.INSTALLATION_ID);
	const binding = await pool.query(
		"SELECT 1 FROM foundation.installation WHERE installation_id=$1 AND binding_id=$2 AND recovery_epoch=$3",
		[publication.installationId, publication.bindingId, publication.epoch],
	);
	if (binding.rowCount !== 1) throw new Error("Worker readiness required");
}
const boss = new PgBoss({
	connectionString: env.WORKER_DATABASE_URL,
	migrate: false,
	createSchema: false,
	// Expire abandoned claims and retain bounded queue history without runtime DDL.
	supervise: true,
	superviseIntervalSeconds: 5,
	monitorIntervalSeconds: 5,
	reindex: false,
	schedule: false,
});
const heartbeatPath =
	process.env.WORKER_HEARTBEAT_PATH ?? "/tmp/saas-cook-worker.json";
const payload = z
	.object({
		id: z.uuid(),
		requestId: z.uuid(),
		trace: z.record(z.string(), z.string()).default({}),
	})
	.strict();
let stopping = false;
let timer: NodeJS.Timeout | undefined;
let pendingHeartbeat: Promise<void> = Promise.resolve();
let pendingBilling: Promise<void> | undefined;
let billingTimer: NodeJS.Timeout | undefined;
let platformTimer: NodeJS.Timeout | undefined;
let pendingPlatform: Promise<void> | undefined;
async function billingTick() {
	await ready();
	await billingWorker?.tick();
	await deliverBillingNotices(pool, {
		secret: env.AUTH_SECRET,
		origin: env.APP_ORIGIN,
		transport: mailTransport,
		ready: authorization.publication,
		authorize: (c, user, o) => authorization.authorize(c, user, o, "billing"),
	});
}
async function heartbeat() {
	await ready();
	await deliverIdentityEmails(pool, {
		secret: env.AUTH_SECRET,
		transport: mailTransport,
		limit: 5,
	});
	await recordHeartbeat(pool, "worker");
	await writeFile(
		`${heartbeatPath}.tmp`,
		JSON.stringify({ pid: process.pid, at: Date.now() }),
	);
	await rename(`${heartbeatPath}.tmp`, heartbeatPath);
}
async function stop(code: number) {
	if (stopping) return;
	stopping = true;
	clearInterval(timer);
	clearInterval(billingTimer);
	clearInterval(platformTimer);
	clearInterval(completionTimer);
	const deadline = setTimeout(() => process.exit(1), 12_000);
	try {
		await boss.stop({ graceful: true, timeout: 8_000 });
		await pendingHeartbeat.catch(() => {});
		await pendingBilling?.catch(() => {});
		await pendingPlatform?.catch(() => {});
		await pendingCompletion?.catch(() => {});
		await completion?.close();
		await pool.end();
		await controlPool.end();
		await rm(heartbeatPath, { force: true });
		logEvent("worker.stopped", { service: "worker", status: code });
		await shutdownObservability();
	} finally {
		clearTimeout(deadline);
		process.exit(code);
	}
}
boss.on("error", () => {
	logEvent("worker.queue_failed");
	void stop(1);
});
pool.on("error", () => {
	void stop(1);
});
process.once("SIGTERM", () => {
	void stop(0);
});
process.once("SIGINT", () => {
	void stop(0);
});
let startupOperation = "worker.heartbeat_cleanup";
try {
	await rm(heartbeatPath, { force: true });
	startupOperation = "worker.readiness";
	await ready();
	startupOperation = "worker.queue_start";
	await boss.start();
	startupOperation = "worker.queue_work";
	await boss.work(
		"runtime-probe",
		{ pollingIntervalSeconds: 1 },
		async (jobs) => {
			for (const job of jobs) {
				const data = payload.parse(job.data);
				await withOperation(
					"runtime.probe",
					{ jobId: job.id, requestId: data.requestId },
					async () => {
						await recordProbe(pool, data.id);
					},
					data.trace,
				);
			}
		},
	);
	startupOperation = "worker.heartbeat";
	await heartbeat();
	timer = setInterval(() => {
		pendingHeartbeat = pendingHeartbeat.then(heartbeat).catch(() => {
			void stop(1);
		});
	}, 2000);
	billingTimer = setInterval(() => {
		if (!pendingBilling)
			pendingBilling = billingTick()
				.catch(() => {
					logEvent("worker.billing_failed");
				})
				.finally(() => {
					pendingBilling = undefined;
				});
	}, 5000);
	// Projection retention is optional work; its failures cannot block billing notices.
	platformTimer = setInterval(() => {
		if (!pendingPlatform)
			pendingPlatform = ready()
				.then(() => pruneActivity(pool, authorization.publication))
				.then(() => pruneFiles(pool, fileStorage, authorization.publication))
				.catch(() => {
					logEvent("worker.platform_retention_failed");
				})
				.finally(() => {
					pendingPlatform = undefined;
				});
	}, 60_000);
	completionTimer = setInterval(() => {
		if (!pendingCompletion)
			pendingCompletion = ready()
				.then(() => completion?.tick())
				.catch(() => {
					logEvent("worker.platform_pending");
				})
				.finally(() => {
					pendingCompletion = undefined;
				});
	}, 5000);
	logEvent("worker.ready");
} catch (error) {
	logEvent("worker.startup_failed", {
		service: "worker",
		operation: startupOperation,
		status: workerFailureStatus(error),
	});
	await stop(1);
}
