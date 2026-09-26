import { rename, rm, writeFile } from "node:fs/promises";
import { readWorkerEnv } from "@common-saas/config/server";
import { recordHeartbeat, recordProbe } from "@common-saas/db";
import {
	initializeObservability,
	logEvent,
	shutdownObservability,
	withOperation,
} from "@common-saas/observability";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { z } from "zod";

const env = readWorkerEnv();
initializeObservability("worker");
const pool = new Pool({
	connectionString: env.WORKER_DATABASE_URL,
	max: 3,
	connectionTimeoutMillis: 3000,
	query_timeout: 3000,
});
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
	process.env.WORKER_HEARTBEAT_PATH ?? "/tmp/common-saas-worker.json";
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
async function heartbeat() {
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
	const deadline = setTimeout(() => process.exit(1), 12_000);
	try {
		await boss.stop({ graceful: true, timeout: 8_000 });
		await pendingHeartbeat.catch(() => {});
		await pool.end();
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
try {
	await rm(heartbeatPath, { force: true });
	await boss.start();
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
	await heartbeat();
	timer = setInterval(() => {
		pendingHeartbeat = pendingHeartbeat.then(heartbeat).catch(() => {
			void stop(1);
		});
	}, 2000);
	logEvent("worker.ready");
} catch {
	logEvent("worker.startup_failed");
	await stop(1);
}
