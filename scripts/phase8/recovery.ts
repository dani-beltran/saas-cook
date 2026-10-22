import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { evidenceImage, evidenceSource, writeEvidence } from "./evidence";
import {
	cleanupRecoveryResources,
	registerRecoveryContainer,
	runWorkerCrashRecovery,
} from "./worker-recovery";

const exec = promisify(execFile);
const image = process.env.TEST_IMAGE ?? "saas-cook:phase2";
const network = "saas-cook-phase1_default";
const output = "artifacts/phase8/recovery";
const startedAt = new Date().toISOString();
const attemptId = randomUUID();
const source = await evidenceSource();
let exactImage: Awaited<ReturnType<typeof evidenceImage>> | undefined;
const containers = new Set<string>();
async function docker(args: string[], timeout = 30_000) {
	try {
		return (
			await exec("docker", args, {
				timeout,
				maxBuffer: 4 * 1024 * 1024,
			})
		).stdout.trim();
	} catch {
		// execFile errors include their complete argv, which contains synthetic credentials.
		throw new Error(`Docker ${args[0]} failed during isolated recovery drill`);
	}
}
async function cleanupContainers() {
	await cleanupRecoveryResources(
		[...containers].map((name) => ({
			label: "Recovery container removal",
			run: async () => {
				await docker(["rm", "-f", name], 5_000);
				containers.delete(name);
			},
		})),
	);
}
function containerUrl(value: string, host: string, port: string) {
	const url = new URL(value);
	url.hostname = host;
	url.port = port;
	return url.toString();
}
await mkdir(output, { recursive: true });
try {
	const metadata = await evidenceImage(image);
	assert.equal(
		metadata.fingerprint,
		source.fingerprint,
		"Rebuild the image for the recovery candidate source",
	);
	assert.equal(
		metadata.revision,
		source.commit,
		"Rebuild the image for the recovery candidate commit",
	);
	exactImage = metadata;
	const result = await runWorkerCrashRecovery(async (env) => {
		const runtime = {
			...env,
			WORKER_DATABASE_URL: containerUrl(
				env.WORKER_DATABASE_URL,
				"postgres",
				"5432",
			),
			CONTROL_DATABASE_URL: containerUrl(
				env.CONTROL_DATABASE_URL,
				"control-postgres",
				"5432",
			),
			OPENFGA_API_URL: "http://openfga:8080",
			SMTP_HOST: "mailpit",
			SMTP_PORT: "1025",
		};
		const id = await registerRecoveryContainer(containers, (name) =>
			docker([
				"run",
				"-d",
				"--name",
				name,
				"--network",
				network,
				"--read-only",
				"--tmpfs",
				"/tmp:rw,nosuid,nodev,size=64m",
				"--entrypoint",
				"/nodejs/bin/node",
				...Object.entries(runtime).flatMap(([key, value]) => [
					"-e",
					`${key}=${value}`,
				]),
				metadata.id,
				"/app/dist/worker.mjs",
			]),
		);
		return {
			async kill() {
				await docker(["kill", "--signal=KILL", id], 5_000);
				assert.equal(
					await docker(["wait", id], 5_000),
					"137",
					"Worker must exit from an actual SIGKILL",
				);
				await docker(["rm", id], 5_000);
				containers.delete(id);
			},
		};
	});
	// Cleanup is part of acceptance; a successful receipt must follow it.
	await cleanupContainers();
	const current = await evidenceSource();
	assert(
		current.commit === source.commit &&
			current.fingerprint === source.fingerprint &&
			current.dirty === source.dirty,
		"Source changed during recovery verification",
	);
	const artifact = `${output}/${attemptId}.json`;
	await writeFile(
		artifact,
		JSON.stringify(
			{
				version: 1,
				kind: "phase8-image-worker-recovery",
				status: "passed",
				startedAt,
				completedAt: new Date().toISOString(),
				imageId: metadata.id,
				sourceCommit: metadata.revision,
				sourceFingerprint: source.fingerprint,
				command: "node --import tsx scripts/phase8/recovery.ts",
				...result,
				limitations: [
					"Disposable local dependencies; diagnostic budget is not a production SLA",
					"Packaged worker crash evidence; full supervisor/HTTP and Commercial provider behavior have separate suites",
				],
			},
			null,
			2,
		),
	);
	await writeEvidence(
		{
			gate: "recovery",
			preset: "commercial-local",
			startedAt,
			source,
			image: metadata,
			outcome: "passed",
			checks: [
				...result.results.map(({ boundary }) => ({
					name: boundary,
					passed: true,
				})),
				{ name: "stable-source", passed: true },
			],
			limitations: [
				"Packaged worker with disposable local dependencies",
				"60-second diagnostic recovery budget is not a production SLA",
				"Commercial provider and restore cases run in the integration suite",
			],
		},
		[artifact],
	);
	process.stdout.write(
		`Image worker crash recovery passed: ${result.results.length} barriers within ${result.budgetMs}ms.\n`,
	);
} catch (error) {
	await writeEvidence({
		gate: "recovery",
		preset: "commercial-local",
		startedAt,
		source,
		...(exactImage ? { image: exactImage } : {}),
		outcome: "failed",
		checks: [{ name: "Image worker crash recovery", passed: false }],
		limitations: ["Failed local diagnostic run retained"],
	});
	throw error;
} finally {
	await cleanupContainers();
}
