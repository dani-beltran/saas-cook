import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual, promisify } from "node:util";
import { evidenceSource, writeEvidence } from "./evidence";
import {
	performanceFixtureEnvironment,
	performanceStorageSafe,
} from "./performance-environment";
import { performanceLog } from "./performance-log";
import { performanceServices } from "./performance-services";

const args = process.argv.slice(2);
if (
	args.length > 1 ||
	(args.length === 1 && !["--smoke", "--ci-smoke"].includes(args[0]))
)
	throw new Error("Usage: phase8:performance [--smoke | --ci-smoke]");
const smoke = args.length === 1;
const source = await evidenceSource();
const startedAt = new Date().toISOString();
const id = randomUUID().replaceAll("-", "");
const exec = promisify(execFile);
const services = performanceServices(id, async (args, timeout = 20000) => {
	try {
		return (
			await exec("docker", args, { timeout, maxBuffer: 4 * 1024 * 1024 })
		).stdout.trim();
	} catch {
		throw new Error("Owned benchmark Docker operation failed");
	}
});
const directory = services.names.directory;
await mkdir(directory, { recursive: true });
const logPath = `${directory}/workload.log`;
let child: ChildProcess | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let forceTimer: ReturnType<typeof setTimeout> | undefined;
let activeSample: Promise<void> | undefined;
let cleanupTask: Promise<boolean> | undefined;
let cleanupRequested = false;
let interrupted = false;
let infrastructureHealthy = true;
let driverCode: number | null = null;
const samples: unknown[] = [];
const failures: string[] = [];
function interrupt(reason: string) {
	if (!failures.includes(reason)) failures.push(reason);
	interrupted = true;
	child?.kill("SIGTERM");
	if (child && !forceTimer)
		// Allow the driver's bounded fixture cleanup and 90-second wrapper handshake to retain failure evidence.
		forceTimer = setTimeout(() => child?.kill("SIGKILL"), 120000);
}
const log = performanceLog(logPath, () => {
	infrastructureHealthy = false;
	interrupt("workload-log-write");
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.once(signal, () => interrupt(signal));
async function cleanup() {
	if (cleanupTask) return cleanupTask;
	cleanupRequested = true;
	clearInterval(timer);
	cleanupTask = (async () => {
		await activeSample;
		const result = await services.cleanup();
		if (!(await log.finish())) infrastructureHealthy = false;
		const finalSource = await evidenceSource().catch(() => undefined);
		const sourceStable = isDeepStrictEqual(source, finalSource);
		const passed =
			result.passed && infrastructureHealthy && !interrupted && sourceStable;
		await writeFile(
			`${directory}/cleanup.json`,
			`${JSON.stringify({ version: 1, id, project: services.names.project, source, finalSource, sourceStable, startedAt, finishedAt: new Date().toISOString(), passed, infrastructureHealthy, interrupted, failures, cleanup: result, logScope: "Output received through environment finalization; later diagnostics are console-only", storageSamples: samples }, null, 2)}\n`,
			{ flag: "wx" },
		);
		return passed;
	})();
	return cleanupTask;
}
try {
	if (!smoke && source.dirty)
		throw new Error(
			"Full benchmark requires a clean checkout before provisioning",
		);
	const provisioned = await services.setup();
	const preflightPath = `${directory}/preflight.json`;
	await writeFile(
		preflightPath,
		`${JSON.stringify({ version: 1, source, ...provisioned }, null, 2)}\n`,
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			event: "benchmark.isolation-ready",
			project: provisioned.project,
			preflightPath,
			ports: provisioned.profile.ports,
			containers: provisioned.containers.map(({ id, service }) => ({
				id,
				service,
			})),
		}),
	);
	const env = {
		...process.env,
		...performanceFixtureEnvironment(provisioned.profile),
		PHASE8_BENCHMARK_ENVIRONMENT: JSON.stringify(provisioned.profile),
	};
	await exec(
		process.execPath,
		["--import", "tsx", "scripts/phase1/services-ready.ts"],
		{ env, timeout: 60000 },
	);
	if (interrupted)
		throw new Error("Benchmark interrupted before workload start");
	if (!isDeepStrictEqual(source, await evidenceSource()))
		throw new Error("Source changed during isolated service setup");
	child = spawn(
		process.execPath,
		["--import", "tsx", "scripts/phase8/performance.ts", ...args],
		{ env, stdio: ["ignore", "pipe", "pipe", "ipc"] },
	);
	child.stdout?.on("data", (chunk) => {
		process.stdout.write(chunk);
		log.write(chunk);
	});
	child.stderr?.on("data", (chunk) => {
		process.stderr.write(chunk);
		log.write(chunk);
	});
	child.on("message", (message: unknown) => {
		if (
			message &&
			typeof message === "object" &&
			"type" in message &&
			message.type === "phase8.environment-cleanup-request" &&
			"id" in message &&
			message.id === id
		)
			void cleanup()
				.then((passed) => {
					if (child?.connected)
						child.send({ type: "phase8.environment-cleanup", id, passed });
				})
				.catch(() => {
					infrastructureHealthy = false;
					interrupt("environment-finalization");
				});
	});
	timer = setInterval(() => {
		if (activeSample || cleanupRequested) return;
		activeSample = (async () => {
			try {
				const observation = await services.sample();
				samples.push(observation);
				if (
					observation.volumes.some(
						({ availableBytes }) =>
							!performanceStorageSafe(availableBytes, "measurement"),
					)
				) {
					infrastructureHealthy = false;
					interrupt("storage-reserve");
				}
			} catch {
				infrastructureHealthy = false;
				interrupt("storage-observation");
			}
		})().finally(() => {
			activeSample = undefined;
		});
	}, 30000);
	const [code] = await once(child, "close");
	driverCode = typeof code === "number" ? code : null;
	clearTimeout(forceTimer);
	if (driverCode !== 0) failures.push("workload-exit");
	if (!cleanupRequested) {
		infrastructureHealthy = false;
		failures.push("missing-driver-cleanup-handshake");
	}
} catch {
	infrastructureHealthy = false;
	failures.push("setup-or-driver-failure");
} finally {
	const cleaned = await cleanup().catch(() => false);
	clearInterval(timer);
	clearTimeout(forceTimer);
	if (!(await log.finish())) infrastructureHealthy = false;
	const passed =
		driverCode === 0 && cleaned && infrastructureHealthy && !interrupted;
	if (!passed) {
		const failedPath = `${directory}/failed.json`;
		await writeFile(
			failedPath,
			JSON.stringify({
				status: "failed",
				source,
				driverCode,
				cleaned,
				infrastructureHealthy,
				interrupted,
				failures,
			}),
			{ flag: "wx" },
		);
		const failureArtifacts = [failedPath];
		for (const path of [
			logPath,
			`${directory}/preflight.json`,
			`${directory}/cleanup.json`,
		]) {
			if (
				await readFile(path).then(
					() => true,
					() => false,
				)
			)
				failureArtifacts.push(path);
		}
		for (const gate of args[0] === "--ci-smoke"
			? ["performance-smoke", "performance-ci-correctness"]
			: [smoke ? "performance-smoke" : "performance-full"])
			await writeEvidence(
				{
					gate,
					preset: "commercial-local",
					startedAt,
					source,
					outcome: "failed",
					checks: [{ name: "isolated-environment-execution", passed: false }],
					limitations: [
						"Failed owned environment attempt - cannot establish performance acceptance",
					],
				},
				failureArtifacts,
			);
	}
	console.log(
		JSON.stringify({
			event: "benchmark.isolation-finished",
			project: services.names.project,
			passed,
			directory,
		}),
	);
	process.exitCode = passed ? 0 : 1;
}
