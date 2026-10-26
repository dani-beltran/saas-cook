import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { runWorkerCrashRecovery } from "../../../scripts/phase8/worker-recovery";

it("recovers killed workers before effects and before acknowledgement, deduplicates redelivery, and preserves completed claims", async () => {
	const result = await runWorkerCrashRecovery(async (env) => {
		const heartbeat = `/tmp/phase8-worker-${randomUUID()}.json`;
		const child = spawn(
			process.execPath,
			["--import", "tsx", "apps/worker/src/index.ts"],
			{
				env: {
					...env,
					PATH: process.env.PATH,
					NODE_ENV: "test",
					SMTP_HOST: "127.0.0.1",
					SMTP_PORT: "1026",
					WORKER_HEARTBEAT_PATH: heartbeat,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let diagnostic = "";
		child.stdout.on("data", (bytes) => {
			diagnostic += bytes;
		});
		child.stderr.on("data", (bytes) => {
			diagnostic += bytes;
		});
		return {
			async kill() {
				try {
					if (child.exitCode !== null || child.signalCode !== null)
						throw new Error(
							`Worker exited before deliberate crash: ${diagnostic}`,
						);
					const exited = once(child, "exit");
					child.kill("SIGKILL");
					expect((await exited)[1]).toBe("SIGKILL");
				} finally {
					await Promise.all([
						rm(heartbeat, { force: true }),
						rm(`${heartbeat}.tmp`, { force: true }),
					]);
				}
			},
		};
	});
	expect(result.results).toHaveLength(2);
	for (const scenario of result.results) {
		expect(scenario.recoveryMs).toBeLessThan(result.budgetMs);
		expect(scenario.retries).toBeGreaterThanOrEqual(1);
	}
}, 180_000);
