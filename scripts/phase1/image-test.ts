import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createTestFileStorage } from "../../packages/testing/src/file-storage";
import { sourceFingerprint } from "./source-fingerprint";

const exec = promisify(execFile);
const image = process.env.TEST_IMAGE ?? "saas-cook:phase2";
const network = "saas-cook-phase1_default";
const databaseName = `image_phase2_${randomUUID().replaceAll("-", "")}`;
const restoredDatabase = `${databaseName}_restored`;
const installationId = randomUUID();
const restoredInstallationId = randomUUID();
const authSecret = `synthetic-image-secret-${randomUUID()}`;
const ingressSecret = `synthetic-image-ingress-${randomUUID()}`;
const database = (role: string, name = databaseName) =>
	`postgres://${role}:local_phase1@postgres:5432/${name}`;
const controlDatabase = (role: string) =>
	`postgres://${role}:local_phase2_control@control-postgres:5432/saas_cook_control`;
const containers: string[] = [];
const checks: string[] = [];
let createdDatabase = false;
let createdRestore = false;
let storeId: string | undefined;
let storage: Awaited<ReturnType<typeof createTestFileStorage>> | undefined;
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
		`MIGRATION_DATABASE_URL=${database("saas_cook_migrator", options.database)}`,
		"-e",
		`CONTROL_ADMIN_DATABASE_URL=${controlDatabase("saas_cook_control_admin")}`,
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
		`DATABASE_URL=${database("saas_cook_web")}`,
		"-e",
		`WORKER_DATABASE_URL=${database("saas_cook_worker")}`,
		"-e",
		"PLATFORM_ENABLED=true",
		"-e",
		`LIFECYCLE_DATABASE_URL=${database("saas_cook_lifecycle")}`,
		"-e",
		`JOURNAL_DATABASE_URL=${controlDatabase("saas_cook_journal_writer")}`,
		"-e",
		`IDENTITY_DATABASE_URL=${database("saas_cook_identity")}`,
		"-e",
		`AUTH_SECRET=${authSecret}`,
		"-e",
		`AUTH_INGRESS_SECRET=${ingressSecret}`,
		"-e",
		`CONTROL_DATABASE_URL=${controlDatabase("saas_cook_control_reader")}`,
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
		...Object.entries({
			...storage?.env,
			FILES_S3_ENDPOINT: "http://storage:8333",
		}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
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
		identity.Config.Labels["dev.saas-cook.source-fingerprint"],
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
		"billing-catalogue",
		"billing-reconcile",
		"billing-diagnostics",
		"usage-rebuild",
		"control-schema",
		"recovery",
		"recovery-fingerprint",
		"analytics-report",
		"flags-set",
	]) {
		assert(
			(await docker(["run", "--rm", image, mode, "--help"])).includes(mode),
		);
		if (mode !== "migrate") await rejected(["run", "--rm", image, mode]);
	}
	checks.push("fifteen-packaged-commands-and-missing-credential-refusal");
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
		`CREATE DATABASE ${databaseName} OWNER saas_cook_migrator`,
	);
	createdDatabase = true;
	for (let attempt = 0; attempt < 2; attempt++)
		await docker([
			"run",
			"--rm",
			"--network",
			network,
			"-e",
			`MIGRATION_DATABASE_URL=${database("saas_cook_migrator")}`,
			image,
			"migrate",
		]);
	checks.push("isolated-packaged-migration-and-replay");
	// First execution records a durable pending binding, then fails on a real unreachable FGA endpoint.
	await rejected(command("bootstrap", { openfgaUrl: "http://127.0.0.1:1" }));
	const pending = await sql(
		"control-postgres",
		"saas_cook_control",
		`SELECT epoch||':'||binding_id||':'||state FROM control.installations WHERE installation_id='${installationId}'`,
	);
	assert(pending.endsWith(":initializing"));
	await docker(command("bootstrap"));
	const ready = await sql(
		"control-postgres",
		"saas_cook_control",
		`SELECT epoch||':'||binding_id||':'||state FROM control.installations WHERE installation_id='${installationId}'`,
	);
	assert.equal(ready, pending.replace(/:initializing$/, ":ready"));
	storeId = await sql(
		"control-postgres",
		"saas_cook_control",
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
		`CREATE DATABASE ${restoredDatabase} TEMPLATE ${databaseName} OWNER saas_cook_migrator`,
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
	storage = await createTestFileStorage("http://localhost:3000");
	const id = await start();
	assert.equal(
		await docker(["exec", id, "/nodejs/bin/node", "--version"]),
		"v24.22.0",
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
	// Exercise the shipped API and worker with real identity, quota, S3 and journal effects.
	let cookie = "";
	async function post(path: string, body: unknown) {
		const timestamp = String(Math.floor(Date.now() / 1000));
		const attestation = {
			"x-common-saas-source": "192.0.2.10",
			"x-common-saas-source-time": timestamp,
			"x-common-saas-source-signature": createHmac("sha256", ingressSecret)
				.update(
					`common-saas-ingress:v1\n${timestamp}\nPOST\n${path}\n192.0.2.10`,
				)
				.digest("hex"),
		};
		const response = await fetch(`${origin}${path}`, {
			method: "POST",
			headers: {
				...attestation,
				origin: "http://localhost:3000",
				"content-type": "application/json",
				cookie,
			},
			body: JSON.stringify(body),
		});
		assert.equal(
			response.status,
			200,
			`Packaged platform request failed: ${path}`,
		);
		const cookies = response.headers.getSetCookie();
		if (cookies.length) cookie = cookies.map((v) => v.split(";")[0]).join("; ");
		return response.json();
	}
	const email = `image-platform-${randomUUID()}@example.test`;
	await post("/api/auth/register", {
		email,
		name: "Image acceptance",
		password: "Synthetic image password 2026!",
		locale: "en",
	});
	let token: string | undefined;
	for (let attempt = 0; attempt < 40 && !token; attempt++) {
		const mail = await (
			await fetch(
				`http://127.0.0.1:8026/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
			)
		).json();
		for (const message of mail.messages ?? []) {
			const detail = await (
				await fetch(`http://127.0.0.1:8026/api/v1/message/${message.ID}`)
			).json();
			token = String(detail.Text).match(
				/\/auth\/confirm\?token=([A-Za-z0-9_-]+)/,
			)?.[1];
			if (token) break;
		}
		if (!token) await delay(500);
	}
	assert(
		token,
		"Packaged worker must deliver identity verification to local Mailpit",
	);
	await post("/api/auth/confirm", { token });
	const organization = await post("/api/v1/organizations", {
		name: "Image platform",
		slug: `image-${randomUUID()}`,
		operationKey: randomUUID(),
	});
	await post(`/api/v1/organizations/${organization.id}/projects`, {
		name: "Image exported project",
		slug: "image-exported",
		operationKey: randomUUID(),
	});
	const job = await post("/api/v1/platform/bulkStart", {
		organizationId: organization.id,
		kind: "organization.export",
		operationKey: randomUUID(),
	});
	let download: Response | undefined;
	for (let attempt = 0; attempt < 40; attempt++) {
		download = await fetch(`${origin}/api/v1/platform/bulkDownload`, {
			method: "POST",
			headers: {
				origin: "http://localhost:3000",
				"content-type": "application/json",
				cookie,
			},
			body: JSON.stringify({ organizationId: organization.id, id: job.id }),
		});
		if (download.ok) break;
		await delay(500);
	}
	assert(
		download?.ok,
		"Packaged worker must complete an immutable organization export",
	);
	const exported = await download.json();
	assert(
		Buffer.from(exported.base64, "base64")
			.toString()
			.includes("Image exported project"),
	);
	const request = await post("/api/v1/platform/deletionRequest", {
		kind: "organization",
		organizationId: organization.id,
		operationKey: randomUUID(),
	});
	await post("/api/v1/platform/deletionConfirm", { id: request.id });
	let state = "";
	for (let attempt = 0; attempt < 40; attempt++) {
		state = (
			await post("/api/v1/platform/deletionStatus", {
				id: request.id,
				receipt: request.receipt,
			})
		).state;
		if (state === "complete") break;
		await delay(500);
	}
	assert.equal(
		state,
		"complete",
		"Packaged worker must journal and finish organization cleanup",
	);
	checks.push(
		"packaged-platform-session-export-worker-s3-and-journaled-deletion",
	);

	await node(
		id,
		"const fs=require('node:fs');const web=fs.readFileSync('/tmp/saas-cook-web.pid','utf8');const worker=fs.readFileSync('/tmp/saas-cook-worker.pid','utf8');const w=fs.readFileSync('/proc/'+web+'/environ','utf8');const j=fs.readFileSync('/proc/'+worker+'/environ','utf8');if(w.includes('WORKER_DATABASE_URL=')||j.includes('DATABASE_URL=postgres://saas_cook_web')||j.includes('IDENTITY_DATABASE_URL=')||j.includes('AUTH_INGRESS_SECRET=')||!w.includes('AUTH_INGRESS_SECRET=')||w.includes('CONTROL_ADMIN_DATABASE_URL=')||j.includes('CONTROL_ADMIN_DATABASE_URL='))process.exit(1)",
	);
	checks.push("child-identity-database-and-control-credential-separation");
	await node(
		id,
		"const fs=require('node:fs');const p='/tmp/saas-cook-worker.json';const data=JSON.parse(fs.readFileSync(p));process.kill(data.pid,'SIGSTOP');data.at=0;fs.writeFileSync(p,JSON.stringify(data));",
	);
	await rejected([
		"exec",
		id,
		"/nodejs/bin/node",
		"/app/infra/docker/healthcheck.cjs",
	]);
	await node(
		id,
		"process.kill(Number(require('node:fs').readFileSync('/tmp/saas-cook-worker.pid','utf8')),'SIGCONT')",
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
			`process.kill(Number(require('node:fs').readFileSync('/tmp/saas-cook-${child}.pid','utf8')),'SIGKILL')`,
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
		"process.kill(Number(require('node:fs').readFileSync('/tmp/saas-cook-worker.pid','utf8')),'SIGSTOP')",
	);
	await sql(
		"control-postgres",
		"saas_cook_control",
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
		"process.kill(Number(require('node:fs').readFileSync('/tmp/saas-cook-worker.pid','utf8')),'SIGCONT')",
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
			identity.Config.Labels["dev.saas-cook.source-fingerprint"],
		image: identity.Id,
		architecture: identity.Architecture,
		os: identity.Os,
		buildNode: "24.19.0",
		runtimeNode: "24.22.0",
		bun: "1.4.2",
		baseImage:
			"gcr.io/distroless/nodejs24-debian13:nonroot@sha256:59c479c9b8c123e66047315c968aa2d35e31ae5149c856e4110a79c8b3563f0b",
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
	await storage?.cleanup();
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
		"saas_cook_control",
		`DELETE FROM control.analytics_attempts WHERE installation_id IN ('${installationId}','${restoredInstallationId}'); DELETE FROM control.analytics_subjects WHERE installation_id IN ('${installationId}','${restoredInstallationId}'); DELETE FROM control.deletion_journal WHERE installation_id IN ('${installationId}','${restoredInstallationId}'); DELETE FROM control.journal_heads WHERE installation_id IN ('${installationId}','${restoredInstallationId}'); DELETE FROM control.recovery_runs WHERE installation_id IN ('${installationId}','${restoredInstallationId}'); DELETE FROM control.operator_approvals WHERE installation_id IN ('${installationId}','${restoredInstallationId}'); DELETE FROM control.security_events WHERE installation_id IN ('${installationId}','${restoredInstallationId}'); DELETE FROM control.installations WHERE installation_id IN ('${installationId}','${restoredInstallationId}')`,
	).catch(() => {});
}
