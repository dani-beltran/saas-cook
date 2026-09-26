import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { sourceFingerprint } from "./source-fingerprint";

const exec = promisify(execFile);
const image = process.env.TEST_IMAGE ?? "common-sass:phase1";
const network = "common-saas-phase1_default";
const database = (role: string) =>
	`postgres://${role}:local_phase1@postgres:5432/common_saas`;
const containers: string[] = [];
const checks: string[] = [];
async function docker(args: string[]) {
	return (
		await exec("docker", args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 })
	).stdout.trim();
}
async function rejected(args: string[]) {
	let failed = false;
	try {
		await docker(args);
	} catch {
		failed = true;
	}
	assert(failed, `Command unexpectedly succeeded: ${args[0]}`);
}
async function start() {
	const id = await docker([
		"run",
		"-d",
		"--network",
		network,
		"-p",
		"127.0.0.1::3000",
		"-e",
		`DATABASE_URL=${database("common_saas_web")}`,
		"-e",
		`WORKER_DATABASE_URL=${database("common_saas_worker")}`,
		"-e",
		"APP_ORIGIN=http://localhost:3000",
		image,
	]);
	containers.push(id);
	for (let attempt = 0; attempt < 90; attempt++) {
		const state = JSON.parse(
			await docker(["inspect", "--format", "{{json .State}}", id]),
		);
		if (state.Health?.Status === "healthy") return id;
		if (!state.Running)
			throw new Error(
				`Image exited during startup: ${await docker(["logs", id])}`,
			);
		await delay(500);
	}
	throw new Error(`Image never became healthy: ${await docker(["logs", id])}`);
}
async function awaitExit(id: string) {
	for (let attempt = 0; attempt < 40; attempt++) {
		const state = JSON.parse(
			await docker(["inspect", "--format", "{{json .State}}", id]),
		);
		if (!state.Running) return state.ExitCode as number;
		await delay(500);
	}
	throw new Error("Supervisor did not terminate within its deadline");
}
await mkdir("artifacts/image", { recursive: true });
try {
	const identity = JSON.parse(await docker(["image", "inspect", image]))[0];
	assert.equal(
		identity.Config.Labels["dev.common-saas.source-fingerprint"],
		await sourceFingerprint(),
		"Rebuild the image after implementation changes",
	);
	assert(
		identity.Config.User &&
			identity.Config.User !== "root" &&
			identity.Config.User !== "0",
	);
	checks.push("non-root");
	for (const mode of ["migrate", "bootstrap", "authz-publish"]) {
		assert(
			(await docker(["run", "--rm", image, mode, "--help"])).includes(mode),
		);
	}
	await rejected(["run", "--rm", image, "bootstrap"]);
	await rejected(["run", "--rm", image, "authz-publish"]);
	checks.push("command-packaging-and-phase2-refusal");
	await rejected(["run", "--rm", image]);
	await rejected([
		"run",
		"--rm",
		"-e",
		"APP_ORIGIN=https://example.test",
		"-e",
		"DATABASE_URL=invalid",
		image,
	]);
	checks.push("invalid-config-rejected-before-children");
	for (let attempt = 0; attempt < 2; attempt++)
		await docker([
			"run",
			"--rm",
			"--network",
			network,
			"-e",
			`MIGRATION_DATABASE_URL=${database("common_saas_migrator")}`,
			image,
			"migrate",
		]);
	checks.push("packaged-migration-and-replay");
	const id = await start();
	assert.equal(
		await docker(["exec", id, "/nodejs/bin/node", "--version"]),
		"v24.21.0",
	);
	await docker([
		"exec",
		id,
		"/nodejs/bin/node",
		"-e",
		"const {createRequire}=require('node:module');const r=createRequire('/app/apps/web/server.js');const n=createRequire(r.resolve('next'));n('sharp')({create:{width:1,height:1,channels:4,background:'#fff'}}).png().toBuffer().then(b=>{if(!b.length)process.exit(1)})",
	]);
	checks.push("pinned-runtime-and-native-image-library");
	const port = (await docker(["port", id, "3000/tcp"])).split(":").at(-1);
	const origin = `http://127.0.0.1:${port}`;
	const page = await fetch(`${origin}/en`);
	assert.equal(page.status, 200, "Localized shell must render successfully");
	const html = await page.text();
	assert(html.includes("<html"));
	const assets = [
		...html.matchAll(/(?:src|href)="([^"\s]*\/_next\/static\/[^"\s]*)"/g),
	].map((match) => match[1]);
	assert(assets.length > 0, "No static assets in rendered page");
	for (const asset of new Set(assets)) {
		const response = await fetch(new URL(asset, origin));
		assert.equal(response.status, 200);
		assert(
			!(await response.text()).includes("local_phase1"),
			"Runtime credential in browser asset",
		);
	}
	const publicAsset = await fetch(`${origin}/foundation.svg`);
	assert.equal(publicAsset.status, 200);
	assert.equal((await fetch(`${origin}/api/health`)).status, 200);
	checks.push("startup-static-public-assets-and-combined-health");
	await docker([
		"exec",
		id,
		"/nodejs/bin/node",
		"-e",
		"const fs=require('node:fs');const web=fs.readFileSync('/tmp/common-saas-web.pid','utf8');const worker=fs.readFileSync('/tmp/common-saas-worker.pid','utf8');if(fs.readFileSync('/proc/'+web+'/environ','utf8').includes('WORKER_DATABASE_URL='))process.exit(1);if(fs.readFileSync('/proc/'+worker+'/environ','utf8').includes('DATABASE_URL=postgres://common_saas_web'))process.exit(1)",
	]);
	checks.push("child-credential-separation");
	await docker([
		"exec",
		id,
		"/nodejs/bin/node",
		"-e",
		"const fs=require('node:fs');const p='/tmp/common-saas-worker.json';const data=JSON.parse(fs.readFileSync(p));process.kill(data.pid,'SIGSTOP');data.at=0;fs.writeFileSync(p,JSON.stringify(data));",
	]);
	await rejected([
		"exec",
		id,
		"/nodejs/bin/node",
		"/app/infra/docker/healthcheck.cjs",
	]);
	await docker([
		"exec",
		id,
		"/nodejs/bin/node",
		"-e",
		"process.kill(Number(require('node:fs').readFileSync('/tmp/common-saas-worker.pid','utf8')),'SIGCONT')",
	]);
	checks.push("stale-heartbeat-is-unhealthy");
	await docker(["stop", "--time", "20", id]);
	assert.equal(await awaitExit(id), 0);
	const logs = await docker(["logs", id]);
	assert(logs.includes("worker.stopped"));
	assert(!logs.includes("local_phase1"));
	checks.push("graceful-shutdown-and-redacted-logs");
	await writeFile("artifacts/image/serve.log", logs);
	for (const child of ["web", "worker"]) {
		const testId = await start();
		await docker([
			"exec",
			testId,
			"/nodejs/bin/node",
			"-e",
			`process.kill(Number(require('node:fs').readFileSync('/tmp/common-saas-${child}.pid','utf8')),'SIGKILL')`,
		]);
		assert.notEqual(await awaitExit(testId), 0);
		checks.push(`${child}-failure-stops-container`);
	}
	const report = {
		requirement: "R-IMAGE / Phase 1",
		suiteVersion: 1,
		checks,
		sourceCommit: (await exec("git", ["rev-parse", "HEAD"])).stdout.trim(),
		sourceDirty: Boolean(
			(await exec("git", ["status", "--porcelain"])).stdout.trim(),
		),
		implementationSha256:
			identity.Config.Labels["dev.common-saas.source-fingerprint"],
		image: identity.Id,
		architecture: identity.Architecture,
		os: identity.Os,
		buildNode: "24.19.0",
		runtimeNode: "24.21.0",
		bun: "1.4.2",
		baseImage:
			"gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bb6b03d81066993293a10feda7250e8e1cc034035fe9b61cfceededa7c8bf04d",
		phase2Commands:
			"packaged help and explicit refusal only; real bootstrap/authz publication deferred",
	};
	await writeFile(
		"artifacts/image/acceptance.json",
		`${JSON.stringify(report, null, 2)}\n`,
	);
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
	for (const id of containers) await docker(["rm", "-f", id]).catch(() => {});
}
