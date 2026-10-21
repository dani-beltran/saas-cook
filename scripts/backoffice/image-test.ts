import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { backofficeFixture } from "../../packages/backoffice/src/fixture";
import { sourceFingerprint } from "../phase1/source-fingerprint";

const exec = promisify(execFile),
	image = process.env.BACKOFFICE_TEST_IMAGE ?? "saas-cook-backoffice:local";
const docker = async (args: string[]) =>
	(await exec("docker", args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }))
		.stdout;
const origin = "http://localhost:3105",
	f = await backofficeFixture(origin),
	directory = await mkdtemp(join(tmpdir(), "bo-image-"));
let container = "";
try {
	const inspect = JSON.parse(await docker(["image", "inspect", image]))[0];
	assert.equal(inspect.Config.User, "65532:65532");
	assert.equal(
		inspect.Config.Labels["dev.saas-cook.source-fingerprint"],
		await sourceFingerprint(),
		"image must match final source",
	);
	const inventory = JSON.parse(
		await docker([
			"run",
			"--rm",
			"--entrypoint",
			"/nodejs/bin/node",
			image,
			"-e",
			`const fs=require('node:fs');console.log(JSON.stringify({node:process.version,server:fs.existsSync('/app/apps/backoffice/server.js'),static:fs.existsSync('/app/apps/backoffice/.next/static'),customer:fs.existsSync('/app/apps/web'),commands:fs.existsSync('/app/dist/commands'),migrations:fs.existsSync('/app/migrations')}))`,
		]),
	);
	assert.equal(inventory.node, "v24.22.0");
	assert.equal(inventory.server, true);
	assert.equal(inventory.static, true);
	assert.equal(inventory.customer, false);
	assert.equal(inventory.commands, false);
	assert.equal(inventory.migrations, false);
	const env: Record<string, string> = { ...f.env };
	delete env.DATABASE_URL;
	delete env.IDENTITY_DATABASE_URL;
	delete env.WORKER_DATABASE_URL;
	delete env.AUTH_SECRET;
	for (const key of [
		"BACKOFFICE_IDENTITY_DATABASE_URL",
		"BACKOFFICE_DATABASE_URL",
		"CONTROL_DATABASE_URL",
	]) {
		const u = new URL(env[key]);
		u.hostname =
			key === "CONTROL_DATABASE_URL" ? "control-postgres" : "postgres";
		u.port = "5432";
		env[key] = u.toString();
	}
	env.OPENFGA_API_URL = "http://openfga:8080";
	env.NODE_ENV = "production";
	const envFile = join(directory, "env");
	await writeFile(
		envFile,
		Object.entries(env)
			.map(([k, v]) => `${k}=${v}`)
			.join("\n"),
		{ mode: 0o600 },
	);
	container = (
		await docker([
			"run",
			"--detach",
			"--read-only",
			"--tmpfs",
			"/tmp:rw,noexec,nosuid,size=64m",
			"--network",
			"saas-cook-phase1_default",
			"--env-file",
			envFile,
			"-p",
			"127.0.0.1:3105:3001",
			image,
		])
	).trim();
	let live = false;
	for (let i = 0; i < 100; i++) {
		try {
			live = (await fetch(`${origin}/health/live`)).ok;
		} catch {}
		if (live) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	assert(live, "image liveness");
	const url = `${origin}/health/ready`;
	assert.equal((await fetch(url, { headers: f.headers(url) })).status, 200);
	assert.equal((await fetch(`${origin}/en`)).status, 503);
	const page = await fetch(`${origin}/en`, {
		headers: f.headers(`${origin}/en`),
	});
	assert.equal(page.status, 200);
	const html = await page.text();
	assert(html.includes("Staff backoffice"));
	const asset = html.match(/src="([^"]*\/_next\/static[^"]+)"/)?.[1];
	assert(asset);
	assert.equal((await fetch(new URL(asset, origin))).status, 200);
	const started = Date.now();
	await docker(["stop", "--time", "20", container]);
	assert(Date.now() - started < 20000);
	const exit = JSON.parse(await docker(["inspect", container]))[0];
	assert.equal(exit.State.ExitCode, 0);
	await mkdir("artifacts/backoffice", { recursive: true });
	await writeFile(
		"artifacts/backoffice/image.json",
		JSON.stringify(
			{
				imageId: inspect.Id,
				architecture: inspect.Architecture,
				sourceFingerprint:
					inspect.Config.Labels["dev.saas-cook.source-fingerprint"],
				revision: inspect.Config.Labels["org.opencontainers.image.revision"],
				inventory,
				checks: [
					"nonroot",
					"node-runtime",
					"standalone-assets",
					"no-customer-app-or-commands",
					"read-only-root",
					"private-ingress",
					"readiness",
					"graceful-stop",
				],
				status: "passed",
			},
			null,
			2,
		),
	);
	console.log("Backoffice image checks passed");
} catch (error) {
	await mkdir("artifacts/backoffice", { recursive: true });
	await writeFile(
		"artifacts/backoffice/image-failure.json",
		JSON.stringify(
			{
				image,
				error: error instanceof Error ? error.message : "Image check failed",
			},
			null,
			2,
		),
	);
	if (container)
		await writeFile(
			"artifacts/backoffice/image-failure.log",
			await docker(["logs", container]).catch(
				() => "Container logs unavailable",
			),
		);
	throw error;
} finally {
	if (container) await docker(["rm", "-f", container]);
	await rm(directory, { recursive: true, force: true });
	await f.cleanup();
}
