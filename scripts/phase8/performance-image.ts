import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { sourceFingerprint } from "../phase1/source-fingerprint";

const execute = promisify(execFile);
async function docker(args: string[]) {
	try {
		return (
			await execute("docker", args, {
				timeout: 90_000,
				maxBuffer: 8 * 1024 * 1024,
			})
		).stdout.trim();
	} catch {
		const error = new Error(
			"Performance container operation failed; inspect disposable container locally",
		);
		error.name = "PerformanceContainerOperationError";
		throw error;
	}
}
/**
 * Map known disposable Compose loopback endpoints to their private service addresses.
 * @param value Fixture URL, including any restricted-role credentials and database name.
 * @returns A URL on the Compose network only for the exact documented protocol/loopback/port
 * combinations. Externally supplied URLs and unknown local ports are returned unchanged.
 * No credentials are logged; malformed URL input throws before container startup.
 */
export function performanceContainerUrl(value: string) {
	const url = new URL(value);
	if (!["127.0.0.1", "localhost"].includes(url.hostname)) return value;
	const services: Record<string, readonly [string, string]> = {
		"postgres:55433": ["postgres", "5432"],
		"postgresql:55433": ["postgres", "5432"],
		"postgres:55434": ["control-postgres", "5432"],
		"postgresql:55434": ["control-postgres", "5432"],
		"http:18081": ["openfga", "8080"],
		"http:19000": ["storage", "8333"],
	};
	const service = services[`${url.protocol}${url.port}`];
	if (!service) return value;
	[url.hostname, url.port] = service;
	return url.toString().replace(/\/$/, "");
}

/** Starts the exact, non-root customer image with disposable restricted credentials.
 * @param env Validated fixture environment; never pass ambient production credentials.
 * @returns HTTP origin, immutable image/observer metadata and bounded telemetry/stop methods.
 * Throws before load if the image is stale or startup fails. Caller must call stop before fixture cleanup.
 */
export async function startPerformanceImage(env: Record<string, string>) {
	const reference = process.env.TEST_IMAGE ?? "saas-cook:phase2";
	const metadata = JSON.parse(await docker(["image", "inspect", reference]))[0];
	assert.equal(
		metadata.Config.Labels?.["dev.saas-cook.source-fingerprint"],
		await sourceFingerprint(),
		"Rebuild the customer image for the current source before performance validation",
	);
	assert.equal(
		metadata.Config.Labels?.["org.opencontainers.image.revision"],
		(await execute("git", ["rev-parse", "HEAD"])).stdout.trim(),
		"Image revision must match the source commit",
	);
	assert.equal(
		metadata.Config.Labels?.["org.opencontainers.image.title"],
		"saas-cook",
	);
	assert(
		metadata.Config.User &&
			!["root", "0", "0:0"].includes(metadata.Config.User),
	);
	const observer = resolve("scripts/phase8/performance-observer.cjs");
	const observerHash = createHash("sha256")
		.update(await readFile(observer))
		.digest("hex");
	const environment = Object.fromEntries(
		Object.entries(env).map(([key, value]) => [
			key,
			/(?:DATABASE_URL|API_URL|ENDPOINT)$/.test(key)
				? performanceContainerUrl(value)
				: value,
		]),
	);
	const origin = "http://localhost:3000";
	const id = await docker([
		"run",
		"--detach",
		"--network",
		"saas-cook-phase1_default",
		"--read-only",
		"--tmpfs",
		"/tmp:rw,noexec,nosuid,size=128m",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--publish",
		"127.0.0.1::3000",
		"--mount",
		`type=bind,src=${observer},dst=/phase8-observer.cjs,readonly`,
		...Object.entries({
			...environment,
			APP_ORIGIN: origin,
			SMTP_HOST: "mailpit",
			SMTP_PORT: "1025",
			NODE_OPTIONS: "--require=/phase8-observer.cjs",
		}).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
		metadata.Id,
	]);
	async function node(code: string) {
		return docker([
			"exec",
			"--env",
			"NODE_OPTIONS=",
			id,
			"/nodejs/bin/node",
			"-e",
			code,
		]);
	}
	async function stop() {
		await docker(["rm", "--force", id]);
	}
	try {
		for (let attempt = 0; attempt < 120; attempt++) {
			const state = JSON.parse(
				await docker(["inspect", "--format", "{{json .State}}", id]),
			);
			if (!state.Running) {
				const error = new Error("Performance image exited before readiness");
				error.name = "PerformanceImageStartupError";
				throw error;
			}
			if (state.Health?.Status === "healthy") break;
			if (attempt === 119) {
				const error = new Error("Performance image readiness timeout");
				error.name = "PerformanceImageReadinessError";
				throw error;
			}
			await delay(500);
		}
		const binding = JSON.parse(
			await docker([
				"inspect",
				"--format",
				"{{json .NetworkSettings.Ports}}",
				id,
			]),
		)["3000/tcp"][0];
		const hostConfig = JSON.parse(
			await docker(["inspect", "--format", "{{json .HostConfig}}", id]),
		);
		return {
			id,
			origin,
			url: `http://127.0.0.1:${binding.HostPort}`,
			metadata: {
				reference,
				id: metadata.Id,
				architecture: metadata.Architecture,
				os: metadata.Os,
				sourceFingerprint:
					metadata.Config.Labels["dev.saas-cook.source-fingerprint"],
				revision: metadata.Config.Labels["org.opencontainers.image.revision"],
				observerHash,
				containerLimits: {
					memoryBytes: hostConfig.Memory,
					nanoCpus: hostConfig.NanoCpus,
					cpuQuota: hostConfig.CpuQuota,
					cpuPeriod: hostConfig.CpuPeriod,
					cpusetCpus: hostConfig.CpusetCpus,
					pidsLimit: hostConfig.PidsLimit,
				},
				observer:
					"read-only preload; bounded aggregate telemetry adds measured overhead; no authorization or request changes",
				runtime: await node("process.stdout.write(process.version)"),
			},
			/** Sets one measured interval in epoch milliseconds in the isolated container. */
			async measure(start: number, end: number) {
				assert(start > Date.now() && end > start);
				await node(
					`require('node:fs').writeFileSync('/tmp/phase8-window.json',JSON.stringify(${JSON.stringify({ start, end })}))`,
				);
			},
			/** Reads aggregate-only web/worker diagnostics; missing or malformed telemetry fails validation. */
			async telemetry() {
				await delay(250);
				return JSON.parse(
					await node(
						"const fs=require('node:fs'); process.stdout.write(JSON.stringify(fs.readdirSync('/tmp').filter(p=>/^phase8-observer-[0-9]+\\.json$/.test(p)).map(p=>JSON.parse(fs.readFileSync('/tmp/'+p,'utf8')))))",
					),
				);
			},
			/** Uploads bounded synthetic CSV to the image-issued storage URL without exposing its signature. */
			async upload(url: string, headers: Record<string, string>, body: Buffer) {
				assert.equal(
					new URL(url).origin,
					new URL(environment.FILES_S3_ENDPOINT).origin,
				);
				assert(body.byteLength <= 1048576);
				const status = await node(
					`fetch(${JSON.stringify(url)},{method:'PUT',headers:${JSON.stringify(headers)},body:Buffer.from(${JSON.stringify(body.toString("base64"))},'base64'),signal:AbortSignal.timeout(10000)}).then(r=>process.stdout.write(String(r.status))).catch(()=>process.exit(1))`,
				);
				assert(
					Number(status) >= 200 && Number(status) < 300,
					"Synthetic CSV upload failed",
				);
			},
			stop,
		};
	} catch (error) {
		await stop();
		throw error;
	}
}
