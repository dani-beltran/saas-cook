import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { hasProbe } from "@common-saas/db";
import {
	initializeObservability,
	traceCarrier,
	withOperation,
} from "@common-saas/observability";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { expect, it } from "vitest";
import { createTestInstallation } from "../../../packages/testing/src/installation";

it("reclaims an abandoned claim and processes durable jobs with restricted credentials, trace correlation and graceful shutdown", async () => {
	const installation = await createTestInstallation();
	const databaseUrl = installation.env.WORKER_DATABASE_URL;
	const pool = new Pool({ connectionString: databaseUrl });
	const boss = new PgBoss({
		connectionString: databaseUrl,
		migrate: false,
		createSchema: false,
		supervise: false,
		schedule: false,
	});
	boss.on("error", () => {});
	let child: ChildProcess | undefined;
	let logs = "";
	try {
		await boss.start();
		initializeObservability("web");
		const id = randomUUID();
		const requestId = randomUUID();
		const abandonedId = randomUUID();
		const abandonedJob = await boss.send(
			"runtime-probe",
			{ id: abandonedId, requestId, trace: {} },
			{ priority: 2_147_483_647, expireInSeconds: 1, retryDelay: 1 },
		);
		if (!abandonedJob) throw new Error("Synthetic job was not enqueued");
		const claimed = await boss.fetch("runtime-probe");
		expect(claimed[0]?.id).toBe(abandonedJob);
		expect((await boss.getJobById("runtime-probe", abandonedJob))?.state).toBe(
			"active",
		);
		// Simulate a process dying after it claimed work. No explicit fail/complete:
		// the independently started worker must expire and recover the abandoned job.
		let carrier: Record<string, string> = {};
		await withOperation("probe.enqueue", { requestId }, async () => {
			carrier = traceCarrier();
			await boss.send("runtime-probe", { id, requestId, trace: carrier });
			await boss.send("runtime-probe", { id, requestId, trace: carrier });
		});
		child = spawn(
			process.execPath,
			["--import", "tsx", "apps/worker/src/index.ts"],
			{
				env: {
					NODE_ENV: "test",
					PATH: process.env.PATH,
					WORKER_DATABASE_URL: databaseUrl,
					AUTH_SECRET: installation.env.AUTH_SECRET,
					CONTROL_DATABASE_URL: installation.env.CONTROL_DATABASE_URL,
					INSTALLATION_ID: installation.env.INSTALLATION_ID,
					OPENFGA_API_URL: installation.env.OPENFGA_API_URL,
					SMTP_HOST: "127.0.0.1",
					SMTP_PORT: "1026",
					WORKER_HEARTBEAT_PATH: `/tmp/phase1-worker-${id}.json`,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		child.stdout?.on("data", (chunk) => {
			logs += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			logs += chunk;
		});
		let processed = false;
		let recovered = false;
		for (let attempt = 0; attempt < 150; attempt++) {
			processed = await hasProbe(pool, id);
			recovered = await hasProbe(pool, abandonedId);
			if (processed && recovered && logs.includes(requestId)) break;
			if (child.exitCode !== null) throw new Error(`Worker exited: ${logs}`);
			await delay(100);
		}
		expect(processed).toBe(true);
		expect(recovered).toBe(true);
		expect(
			(await boss.getJobById("runtime-probe", abandonedJob))?.retryCount,
		).toBeGreaterThanOrEqual(1);
		expect(logs).toContain(requestId);
		expect(logs).toContain(carrier.traceparent?.split("-")[1]);
		expect(logs).not.toContain("local_phase1");
		const exited = once(child, "exit");
		child.kill("SIGTERM");
		expect((await exited)[0]).toBe(0);
		expect(logs).toContain("worker.stopped");
		expect(
			(
				await pool.query(
					"SELECT count(*)::int AS count FROM foundation.runtime_probes WHERE id=$1",
					[id],
				)
			).rows[0].count,
		).toBe(1);
	} finally {
		if (child && child.exitCode === null && child.signalCode === null) {
			const exited = once(child, "exit");
			child.kill("SIGKILL");
			await exited;
		}
		try {
			await boss.stop();
		} finally {
			await pool.end();
			await installation.cleanup();
		}
	}
});
