import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { sourceFingerprint } from "./source-fingerprint";

const exec = promisify(execFile);
const image = process.env.TEST_IMAGE ?? "common-sass:phase2";
const network = "common-saas-phase1_default";
const databaseName = `image_phase2_${randomUUID().replaceAll("-", "")}`;
const restoredDatabase = `${databaseName}_restored`;
const installationId = randomUUID();
const restoredInstallationId = randomUUID();
const authSecret = `synthetic-image-secret-${randomUUID()}`;
const ingressSecret = `synthetic-image-ingress-${randomUUID()}`;
const database = (role: string, name = databaseName) =>
	`postgres://${role}:local_phase1@postgres:5432/${name}`;
const controlDatabase = (role: string) =>
	`postgres://${role}:local_phase2_control@control-postgres:5432/common_saas_control`;
const containers: string[] = [];
const checks: string[] = [];
let createdDatabase = false;
let createdRestore = false;
let storeId: string | undefined;
async function docker(args: string[]) {
	return (
		await exec("docker", args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 })
	).stdout.trim();
}
async function sql(
	service: "postgres" | "control-postgres",
	database: string,
	statement: string,
) {
	return docker([
		"compose",
		"-f",
		"infra/compose.yaml",
		"exec",
		"-T",
		service,
		"psql",
		"-U",
		"postgres",
		"-d",
		database,
		"-v",
		"ON_ERROR_STOP=1",
		"-Atc",
		statement,
	]);
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
function command(
	mode: string,
	options: {
		openfgaUrl?: string;
		installationId?: string;
		database?: string;
	} = {},
) {
	return [
		"run",
		"--rm",
		"--network",
		network,
		"-e",
		`MIGRATION_DATABASE_URL=${database("common_saas_migrator", options.database)}`,
		"-e",
		`CONTROL_ADMIN_DATABASE_URL=${controlDatabase("common_saas_control_admin")}`,
		"-e",
		`INSTALLATION_ID=${options.installationId ?? installationId}`,
		"-e",
		`OPENFGA_API_URL=${options.openfgaUrl ?? "http://openfga:8080"}`,
		image,
		mode,
	];
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
		`IDENTITY_DATABASE_URL=${database("common_saas_identity")}`,
		"-e",
		`AUTH_SECRET=${authSecret}`,
		"-e",
		`AUTH_INGRESS_SECRET=${ingressSecret}`,
		"-e",
		`CONTROL_DATABASE_URL=${controlDatabase("common_saas_control_reader")}`,
		"-e",
		`INSTALLATION_ID=${installationId}`,
		"-e",
		"OPENFGA_API_URL=http://openfga:8080",
		"-e",
		"SMTP_HOST=mailpit",
		"-e",
		"SMTP_PORT=1025",
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
const node = (id: string, code: string) =>
	docker(["exec", id, "/nodejs/bin/node", "-e", code]);
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
	for (const mode of [
		"migrate",
		"bootstrap",
		"authz-publish",
		"authz-upgrade",
		"owner-recovery",
		"security-deactivate",
	]) {
		assert(
			(await docker(["run", "--rm", image, mode, "--help"])).includes(mode),
		);
		if (mode !== "migrate") await rejected(["run", "--rm", image, mode]);
	}
	checks.push("five-packaged-commands-and-missing-credential-refusal");
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
	await sql(
		"postgres",
		"postgres",
		`CREATE DATABASE ${databaseName} OWNER common_saas_migrator`,
	);
	createdDatabase = true;
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
	checks.push("isolated-packaged-migration-and-replay");
	// First execution records a durable pending binding, then fails on a real unreachable FGA endpoint.
	await rejected(command("bootstrap", { openfgaUrl: "http://127.0.0.1:1" }));
	const pending = await sql(
		"control-postgres",
		"common_saas_control",
		`SELECT epoch||':'||binding_id||':'||state FROM control.installations WHERE installation_id='${installationId}'`,
	);
	assert(pending.endsWith(":initializing"));
	await docker(command("bootstrap"));
	const ready = await sql(
		"control-postgres",
		"common_saas_control",
		`SELECT epoch||':'||binding_id||':'||state FROM control.installations WHERE installation_id='${installationId}'`,
	);
	assert.equal(ready, pending.replace(/:initializing$/, ":ready"));
	storeId = await sql(
		"control-postgres",
		"common_saas_control",
		`SELECT store_id FROM control.installations WHERE installation_id='${installationId}'`,
	);
	await docker(command("authz-publish"));
	assert.match(
		await docker(command("bootstrap")),
		/Bootstrap already completed successfully; nothing to do\./,
	);
	checks.push(
		"real-model-bootstrap-resumes-identical-independent-epoch-and-publishes",
	);
	await sql(
		"postgres",
		databaseName,
		`INSERT INTO identity."user"(id,name,email,email_verified) VALUES('${randomUUID()}','Synthetic image identity','image@example.test',true)`,
	);
	await rejected(
		command("bootstrap", { installationId: restoredInstallationId }),
	);
	await sql(
		"postgres",
		"postgres",
		`CREATE DATABASE ${restoredDatabase} TEMPLATE ${databaseName} OWNER common_saas_migrator`,
	);
	createdRestore = true;
	await rejected(
		command("bootstrap", {
			installationId: restoredInstallationId,
			database: restoredDatabase,
		}),
	);
	checks.push(
		"existing-and-restored-application-data-cannot-bootstrap-as-fresh",
	);
	await docker([
		"run",
		"--rm",
		"--entrypoint",
		"/nodejs/bin/node",
		image,
		"-e",
		"require('/app/apps/web/.next/server/app/api/health/route.js').routeModule.ensureUserland().catch(()=>process.exit(1))",
	]);
	checks.push("compiled-identity-route-loads-native-avatar-dependencies");
	const id = await start();
	assert.equal(
		await docker(["exec", id, "/nodejs/bin/node", "--version"]),
		"v24.21.0",
	);
	await node(
		id,
		"const {createRequire}=require('node:module');const r=createRequire('/app/apps/web/server.js');const n=createRequire(r.resolve('next'));const sharp=n('sharp');(async()=>{for(const format of ['jpeg','png','webp']){const b=await sharp({create:{width:640,height:480,channels:3,background:'#148c80'}}).withMetadata({orientation:6}).toFormat(format).toBuffer();const out=await sharp(b,{failOn:'warning',limitInputPixels:16000000}).autoOrient().resize(512,512,{fit:'cover',withoutEnlargement:true}).webp({quality:82}).toBuffer();const m=await sharp(out).metadata();if(m.format!=='webp'||m.width>512||m.height>512||m.exif||m.icc)throw new Error('Avatar native pipeline failed')}})().catch(()=>process.exit(1))",
	);
	checks.push(
		"pinned-runtime-and-native-image-library",
		"native-avatar-jpeg-png-webp-orientation-resize-metadata-strip",
	);
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
		const text = await response.text();
		assert(
			!text.includes("local_phase1") &&
				!text.includes("local_phase2_control") &&
				!text.includes(authSecret) &&
				!text.includes(ingressSecret),
			"Runtime credential in browser asset",
		);
	}
	assert.equal((await fetch(`${origin}/foundation.svg`)).status, 200);
	assert.equal((await fetch(`${origin}/api/health`)).status, 200);
	checks.push("startup-static-public-assets-and-combined-health");
	await node(
		id,
		"const fs=require('node:fs');const web=fs.readFileSync('/tmp/common-saas-web.pid','utf8');const worker=fs.readFileSync('/tmp/common-saas-worker.pid','utf8');const w=fs.readFileSync('/proc/'+web+'/environ','utf8');const j=fs.readFileSync('/proc/'+worker+'/environ','utf8');if(w.includes('WORKER_DATABASE_URL=')||j.includes('DATABASE_URL=postgres://common_saas_web')||j.includes('IDENTITY_DATABASE_URL=')||j.includes('AUTH_INGRESS_SECRET=')||!w.includes('AUTH_INGRESS_SECRET=')||w.includes('CONTROL_ADMIN_DATABASE_URL=')||j.includes('CONTROL_ADMIN_DATABASE_URL='))process.exit(1)",
	);
	checks.push("child-identity-database-and-control-credential-separation");
	await node(
		id,
		"const fs=require('node:fs');const p='/tmp/common-saas-worker.json';const data=JSON.parse(fs.readFileSync(p));process.kill(data.pid,'SIGSTOP');data.at=0;fs.writeFileSync(p,JSON.stringify(data));",
	);
	await rejected([
		"exec",
		id,
		"/nodejs/bin/node",
		"/app/infra/docker/healthcheck.cjs",
	]);
	await node(
		id,
		"process.kill(Number(require('node:fs').readFileSync('/tmp/common-saas-worker.pid','utf8')),'SIGCONT')",
	);
	checks.push("stale-heartbeat-is-unhealthy");
	await docker(["stop", "--time", "20", id]);
	assert.equal(await awaitExit(id), 0);
	const logs = await docker(["logs", id]);
	assert(logs.includes("worker.stopped"));
	assert(
		!logs.includes("local_phase1") &&
			!logs.includes("local_phase2_control") &&
			!logs.includes(authSecret) &&
			!logs.includes(ingressSecret),
	);
	checks.push("graceful-shutdown-and-redacted-logs");
	await writeFile("artifacts/image/serve.log", logs);
	for (const child of ["web", "worker"]) {
		const testId = await start();
		await node(
			testId,
			`process.kill(Number(require('node:fs').readFileSync('/tmp/common-saas-${child}.pid','utf8')),'SIGKILL')`,
		);
		assert.notEqual(await awaitExit(testId), 0);
		checks.push(`${child}-failure-stops-container`);
	}
	const recoveryId = await start();
	const recoveryPort = (await docker(["port", recoveryId, "3000/tcp"]))
		.split(":")
		.at(-1);
	// Keep the worker paused briefly so the health endpoint can report the mismatch before supervision exits.
	await node(
		recoveryId,
		"process.kill(Number(require('node:fs').readFileSync('/tmp/common-saas-worker.pid','utf8')),'SIGSTOP')",
	);
	await sql(
		"control-postgres",
		"common_saas_control",
		`UPDATE control.installations SET epoch='${randomUUID()}' WHERE installation_id='${installationId}'`,
	);
	assert.equal(
		(await fetch(`http://127.0.0.1:${recoveryPort}/api/health`)).status,
		503,
	);
	await rejected([
		"exec",
		recoveryId,
		"/nodejs/bin/node",
		"/app/infra/docker/healthcheck.cjs",
	]);
	await rejected(command("authz-publish"));
	await node(
		recoveryId,
		"process.kill(Number(require('node:fs').readFileSync('/tmp/common-saas-worker.pid','utf8')),'SIGCONT')",
	);
	assert.notEqual(await awaitExit(recoveryId), 0);
	checks.push(
		"independent-epoch-mismatch-closes-health-worker-and-publication",
	);
	const report = {
		requirement: "R-IMAGE / Phase 2",
		suiteVersion: 2,
		checkedAt: new Date().toISOString(),
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
			"Real packaged migration, interrupted/resumed model bootstrap, independent readiness, existing/restored-data rejection and authz publication; operator command help/credential rejection. Signed operator mutation covered by real-service integration suite.",
	};
	await writeFile(
		"artifacts/image/acceptance.json",
		`${JSON.stringify(report, null, 2)}\n`,
	);
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
	await writeFile(
		"artifacts/image/failure.json",
		`${JSON.stringify({ requirement: "R-IMAGE / Phase 2", checks, error: error instanceof Error ? error.message : "Image acceptance failed" }, null, 2)}\n`,
	);
	for (const [index, id] of containers.entries())
		await writeFile(
			`artifacts/image/container-${index}.log`,
			await docker(["logs", id]).catch(() => "Logs unavailable"),
		);
	throw error;
} finally {
	for (const id of containers) await docker(["rm", "-f", id]).catch(() => {});
	if (createdRestore)
		await sql(
			"postgres",
			"postgres",
			`DROP DATABASE ${restoredDatabase} WITH (FORCE)`,
		).catch(() => {});
	if (createdDatabase)
		await sql(
			"postgres",
			"postgres",
			`DROP DATABASE ${databaseName} WITH (FORCE)`,
		).catch(() => {});
	if (storeId)
		await fetch(
			`${process.env.OPENFGA_API_URL ?? "http://127.0.0.1:18081"}/stores/${storeId}`,
			{ method: "DELETE", signal: AbortSignal.timeout(5000) },
		).catch(() => {});
	await sql(
		"control-postgres",
		"common_saas_control",
		`DELETE FROM control.operator_approvals WHERE installation_id IN ('${installationId}','${restoredInstallationId}'); DELETE FROM control.security_events WHERE installation_id IN ('${installationId}','${restoredInstallationId}'); DELETE FROM control.installations WHERE installation_id IN ('${installationId}','${restoredInstallationId}')`,
	).catch(() => {});
}
