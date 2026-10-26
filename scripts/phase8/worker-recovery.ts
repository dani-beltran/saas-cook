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
const queryBudgetMs = 5_000;
const cleanupBudgetMs = 10_000;

/**
 * Bound a harness operation, including a successful response after its deadline.
 * @param operation An asynchronous operation with its own I/O cancellation or timeouts.
 * @param timeoutMs Remaining positive wall-clock budget in milliseconds.
 * @param label Static diagnostic label; never include credentials or caller payloads.
 * @returns The operation result only if it arrives strictly before the deadline.
 * @throws Error on timeout or propagates the operation failure. A deadline bounds waiting;
 * callers must additionally bound the underlying SQL, process or network operation.
 */
export async function withinRecoveryDeadline<T>(
	operation: () => Promise<T>,
	timeoutMs: number,
	label: string,
) {
	const deadline = performance.now() + timeoutMs;
	const expired = () => new Error(`${label}: recovery deadline exceeded`);
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw expired();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const result = await Promise.race([
			Promise.resolve().then(operation),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(expired()), timeoutMs);
			}),
		]);
		// A blocked event loop can deliver the operation before the timeout callback.
		if (performance.now() >= deadline) throw expired();
		return result;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Poll until a condition is true within one total elapsed-time budget.
 * @param check Bounded database observation returning whether the boundary was reached.
 * @param label Static name used in timeout diagnostics.
 * @param timeoutMs Total budget including every check and poll delay; defaults to 60 seconds.
 * @returns Nothing once a timely observation succeeds; rejects on a late or hung check.
 */
export async function waitForRecovery(
	check: () => Promise<boolean>,
	label: string,
	timeoutMs = budgetMs,
) {
	const deadline = performance.now() + timeoutMs;
	while (true) {
		if (
			await withinRecoveryDeadline(check, deadline - performance.now(), label)
		)
			return;
		const remaining = deadline - performance.now();
		if (remaining <= 0) throw new Error(`${label}: recovery deadline exceeded`);
		await delay(Math.min(25, remaining));
	}
}

/**
 * Attempt every cleanup even when earlier steps fail or never settle.
 * @param steps Named cleanup callbacks with bounded underlying I/O, in dependency order.
 * @returns Nothing after every step succeeds; otherwise throws an AggregateError containing
 * all observed failures. Per-step deadlines default to ten seconds and never imply success.
 */
export async function cleanupRecoveryResources(
	steps: Array<{
		label: string;
		run: () => Promise<unknown>;
		timeoutMs?: number;
	}>,
) {
	const failures: unknown[] = [];
	for (const { label, run, timeoutMs = cleanupBudgetMs } of steps) {
		try {
			await withinRecoveryDeadline(run, timeoutMs, label);
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length)
		throw new AggregateError(failures, "Isolated recovery cleanup failed");
}

/**
 * Register a unique Docker name before startup can create a container or fail.
 * @param containers Attempt-owned names retained until confirmed removal.
 * @param start Starts the container using the supplied name; may reject after creation.
 * @returns Its registered name on success. Failure preserves the name for final cleanup.
 */
export async function registerRecoveryContainer(
	containers: Set<string>,
	start: (name: string) => Promise<unknown>,
) {
	const name = `phase8-recovery-${randomUUID()}`;
	containers.add(name);
	await start(name);
	return name;
}

/**
 * Exercise actual worker death on both sides of its durable application effect.
 * `start` launches a worker with the supplied isolated, restricted-role environment.
 * PostgreSQL advisory barriers stop the worker before the effect or queue acknowledgement;
 * the driver kills it, starts a replacement, and verifies bounded, exactly-once effects.
 * Returns timings against a predeclared 60-second local diagnostic recovery budget.
 * Throws on lost/duplicate effects, missing replay, timeout or failed cleanup. Cleanup always
 * attempts only its generated databases and OpenFGA store. This is not a deployment SLA.
 */
export async function runWorkerCrashRecovery(
	start: (env: Record<string, string>) => Promise<RecoveryWorker>,
) {
	const installation = await createTestInstallation();
	const harnessPoolOptions = {
		max: 4,
		connectionTimeoutMillis: queryBudgetMs,
		query_timeout: queryBudgetMs,
		statement_timeout: queryBudgetMs,
		lock_timeout: queryBudgetMs,
	};
	const app = new Pool({
		...harnessPoolOptions,
		connectionString: installation.migrationUrl,
	});
	const admin = new Pool({
		...harnessPoolOptions,
		connectionString:
			process.env.TEST_DATABASE_ADMIN_URL ??
			"postgres://postgres:local_phase1@127.0.0.1:55433/postgres",
	});
	const queue = new Pool({
		...harnessPoolOptions,
		connectionString: installation.env.WORKER_DATABASE_URL,
	});
	const boss = new PgBoss({
		db: { executeSql: (text, values) => queue.query(text, values) },
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
	async function killWorker() {
		if (!worker) return;
		const active = worker;
		await withinRecoveryDeadline(
			() => active.kill(),
			20_000,
			"Worker termination",
		);
		worker = undefined;
	}
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
				worker = await withinRecoveryDeadline(
					() => start(installation.env),
					budgetMs,
					"Worker start",
				);
				await waitForRecovery(
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
				await killWorker();
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
				worker = await withinRecoveryDeadline(
					() => start(installation.env),
					budgetMs,
					"Replacement worker start",
				);
				await waitForRecovery(
					async () =>
						(await boss.getJobById("runtime-probe", jobId))?.state ===
						"completed",
					"Replacement worker completion",
					budgetMs - (performance.now() - returnedAt),
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
				await waitForRecovery(
					async () =>
						(await boss.getJobById("runtime-probe", duplicate))?.state ===
						"completed",
					"Duplicate delivery acknowledgement",
				);
				await killWorker();
				worker = await withinRecoveryDeadline(
					() => start(installation.env),
					budgetMs,
					"Post-acknowledgement worker start",
				);
				const sentinel = await boss.send("runtime-probe", {
					id: randomUUID(),
					requestId: randomUUID(),
					trace: {},
				});
				assert(sentinel);
				await waitForRecovery(
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
				await killWorker();
			} finally {
				await cleanupRecoveryResources([
					{
						label: "Barrier worker cleanup",
						run: killWorker,
						timeoutMs: 20_000,
					},
					{
						label: "Barrier connection cleanup",
						run: async () => {
							try {
								await blocker.query("SELECT pg_advisory_unlock_all()");
							} finally {
								// Destroy the held session even when the unlock query fails.
								blocker.release(true);
							}
						},
					},
					{
						label: "Barrier trigger cleanup",
						run: () =>
							app.query(
								`DROP TRIGGER IF EXISTS phase8_crash_barrier ON ${table}`,
							),
					},
					{
						label: "Barrier function cleanup",
						run: () =>
							app.query(
								"DROP FUNCTION IF EXISTS foundation.phase8_crash_barrier()",
							),
					},
				]);
			}
		}
		return { budgetMs, results };
	} finally {
		await cleanupRecoveryResources([
			{ label: "Final worker cleanup", run: killWorker, timeoutMs: 20_000 },
			{
				label: "Queue harness shutdown",
				run: () => boss.stop({ graceful: false }),
			},
			{ label: "Application harness pool shutdown", run: () => app.end() },
			{ label: "Administrator harness pool shutdown", run: () => admin.end() },
			{ label: "Queue harness pool shutdown", run: () => queue.end() },
			{
				label: "Disposable installation cleanup",
				run: installation.cleanup,
				timeoutMs: 30_000,
			},
		]);
	}
}
