import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { createTestInstallation } from "../../packages/testing/src/installation";

/** A disposable worker started by the source-process or exact-image test driver. */
interface RecoveryWorker {
	/** Kill this worker without draining its active claim; resolve after exit. */
	kill(): Promise<void>;
}

const budgetMs = 60_000;

async function until(check: () => Promise<boolean>, label: string) {
	const started = performance.now();
	while (!(await check())) {
		assert(
			performance.now() - started < budgetMs,
			`${label}: 60s budget exceeded`,
		);
		await delay(25);
	}
}

/**
 * Exercise actual worker death on both sides of its durable application effect.
 * `start` launches a worker with the supplied isolated, restricted-role environment.
 * PostgreSQL advisory barriers stop the worker before the effect or queue acknowledgement;
 * the driver kills it, starts a replacement, and verifies bounded, exactly-once effects.
 * Returns timings against a predeclared 60-second local diagnostic recovery budget.
 * Throws on lost/duplicate effects, missing replay, or timeout, and always removes only
 * its generated application/control databases and OpenFGA store. This is not a deployment SLA.
 */
export async function runWorkerCrashRecovery(
	start: (env: Record<string, string>) => Promise<RecoveryWorker>,
) {
	const installation = await createTestInstallation();
	const app = new Pool({ connectionString: installation.migrationUrl });
	const admin = new Pool({
		connectionString:
			process.env.TEST_DATABASE_ADMIN_URL ??
			"postgres://postgres:local_phase1@127.0.0.1:55433/postgres",
	});
	const boss = new PgBoss({
		connectionString: installation.env.WORKER_DATABASE_URL,
		migrate: false,
		createSchema: false,
		supervise: false,
		schedule: false,
	});
	boss.on("error", () => {});
	const results: Array<{
		boundary: string;
		recoveryMs: number;
		retries: number;
	}> = [];
	let worker: RecoveryWorker | undefined;
	try {
		await boss.start();
		for (const boundary of [
			"before-effect",
			"before-acknowledgement",
		] as const) {
			const probeId = randomUUID();
			const lockKey = randomInt(1, 2_147_483_647);
			const blocker = await app.connect();
			const table =
				boundary === "before-effect"
					? "foundation.runtime_probes"
					: "pgboss.job";
			const condition =
				boundary === "before-effect"
					? `NEW.id='${probeId}'::uuid`
					: `NEW.name='runtime-probe' AND NEW.data->>'id'='${probeId}' AND NEW.state='completed'`;
			try {
				await blocker.query("SELECT pg_advisory_lock($1)", [lockKey]);
				await app.query(
					`CREATE FUNCTION foundation.phase8_crash_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN PERFORM pg_advisory_xact_lock(${lockKey}); END IF; RETURN NEW; END $$`,
				);
				await app.query(
					`CREATE TRIGGER phase8_crash_barrier BEFORE ${boundary === "before-effect" ? "INSERT" : "UPDATE"} ON ${table} FOR EACH ROW EXECUTE FUNCTION foundation.phase8_crash_barrier()`,
				);
				const jobId = await boss.send(
					"runtime-probe",
					{ id: probeId, requestId: randomUUID(), trace: {} },
					{
						expireInSeconds: 2,
						retryDelay: 1,
						retryLimit: 3,
					},
				);
				assert(
					jobId,
					"Durable job must be accepted before starting the worker",
				);
				worker = await start(installation.env);
				await until(
					async () =>
						(
							await app.query(
								"SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
								[lockKey],
							)
						).rowCount === 1,
					`${boundary} barrier`,
				);
				assert.equal(
					(await boss.getJobById("runtime-probe", jobId))?.state,
					"active",
				);
				assert.equal(
					(
						await app.query(
							"SELECT 1 FROM foundation.runtime_probes WHERE id=$1",
							[probeId],
						)
					).rowCount,
					boundary === "before-effect" ? 0 : 1,
					"The crash barrier must straddle a committed application effect",
				);
				await worker.kill();
				worker = undefined;
				// A blocked PostgreSQL backend may not notice the killed client's socket
				// until its statement resumes. Close precisely this fixture's waiting
				// worker connection before releasing the barrier to retain the crash point.
				const waiting = await app.query(
					"SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.objid=$1 AND NOT l.granted AND a.datname=current_database() AND a.usename='saas_cook_worker'",
					[lockKey],
				);
				for (const row of waiting.rows)
					await admin.query("SELECT pg_terminate_backend($1)", [row.pid]);
				await blocker.query("SELECT pg_advisory_unlock($1)", [lockKey]);
				await app.query(`DROP TRIGGER phase8_crash_barrier ON ${table}`);
				await app.query("DROP FUNCTION foundation.phase8_crash_barrier()");
				const returnedAt = performance.now();
				worker = await start(installation.env);
				await until(
					async () =>
						(await boss.getJobById("runtime-probe", jobId))?.state ===
						"completed",
					"Replacement worker completion",
				);
				const recoveryMs = performance.now() - returnedAt;
				assert(
					recoveryMs < budgetMs,
					"Recovery exceeded the declared local budget",
				);
				const recovered = await boss.getJobById("runtime-probe", jobId);
				assert(
					recovered && recovered.retryCount >= 1 && recovered.retryCount <= 3,
				);
				// Redeliver the same semantic effect, then crash after durable queue acknowledgement.
				const duplicate = await boss.send("runtime-probe", {
					id: probeId,
					requestId: randomUUID(),
					trace: {},
				});
				assert(duplicate);
				await until(
					async () =>
						(await boss.getJobById("runtime-probe", duplicate))?.state ===
						"completed",
					"Duplicate delivery acknowledgement",
				);
				await worker.kill();
				worker = await start(installation.env);
				const sentinel = await boss.send("runtime-probe", {
					id: randomUUID(),
					requestId: randomUUID(),
					trace: {},
				});
				assert(sentinel);
				await until(
					async () =>
						(await boss.getJobById("runtime-probe", sentinel))?.state ===
						"completed",
					"Post-acknowledgement restart",
				);
				assert.equal(
					(await boss.getJobById("runtime-probe", jobId))?.retryCount,
					recovered.retryCount,
				);
				assert.equal(
					(
						await app.query(
							"SELECT count(*)::int AS count FROM foundation.runtime_probes WHERE id=$1",
							[probeId],
						)
					).rows[0].count,
					1,
				);
				results.push({ boundary, recoveryMs, retries: recovered.retryCount });
				await worker.kill();
				worker = undefined;
			} finally {
				try {
					await worker?.kill();
				} finally {
					worker = undefined;
					try {
						await blocker.query("SELECT pg_advisory_unlock_all()");
					} finally {
						blocker.release();
					}
					await app.query(
						`DROP TRIGGER IF EXISTS phase8_crash_barrier ON ${table}`,
					);
					await app.query(
						"DROP FUNCTION IF EXISTS foundation.phase8_crash_barrier()",
					);
				}
			}
		}
		return { budgetMs, results };
	} finally {
		try {
			await worker?.kill();
		} finally {
			try {
				await boss.stop();
			} finally {
				await Promise.all([app.end(), admin.end()]);
				await installation.cleanup();
			}
		}
	}
}
