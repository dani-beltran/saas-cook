import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { publicConfig } from "../../packages/config/src/client";
import { renderRuntimeEmail } from "../../packages/email/src/index";
import { evidenceSource, writeEvidence } from "./evidence";
import {
	adoptTemplateFixture,
	auditTemplateSkillEvidence,
	copyTemplateFixture,
	initializeTemplateEnvironment,
	seedTemplateCustomization,
	templateHashes,
	templatePresetEnvironment,
	validateTemplatePreset,
	verifyRenamedTemplateServer,
} from "./template-workflows";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--smoke") || args.length > 1)
	throw new Error("Usage: bun run phase8:template [--smoke]");
const smoke = args.includes("--smoke");
const root = process.cwd();
const directory = `artifacts/phase8/template/${randomUUID()}`;
const output = path.join(root, directory);
const candidate = path.join(output, "candidate");
await mkdir(output, { recursive: true });
const startedAt = new Date().toISOString();
const source = await evidenceSource();
const checks: { name: string; passed: boolean }[] = [];
const artifacts: string[] = [];
const report: Record<string, unknown> = {
	mode: smoke ? "smoke" : "full",
	source,
	candidate: `${directory}/candidate`,
	commands: [],
};

async function check(name: string, work: () => Promise<void>) {
	console.info(`Template: ${name}`);
	try {
		await work();
		checks.push({ name, passed: true });
	} catch (error) {
		const diagnostic = `${directory}/${name}.failure.log`;
		await writeFile(
			path.join(root, diagnostic),
			error instanceof Error
				? (error.stack ?? error.message)
				: "Unknown failure",
		);
		artifacts.push(diagnostic);
		checks.push({ name, passed: false });
		throw new Error(`Template check failed: ${name}; see ${directory}`);
	}
}
async function command(
	name: string,
	argv: string[],
	cwd = root,
	isolated = false,
) {
	const env: NodeJS.ProcessEnv = isolated
		? {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				NODE_ENV: argv.includes("build") ? "production" : "test",
				CI: "1",
				NEXT_TELEMETRY_DISABLED: "1",
				TURBO_TELEMETRY_DISABLED: "1",
			}
		: { ...process.env, VITEST_REPORT: path.join(output, `${name}.xml`) };
	const started = Date.now();
	const result = spawnSync(argv[0], argv.slice(1), {
		cwd,
		env,
		encoding: "utf8",
		timeout: 900_000,
		maxBuffer: 32 * 1024 * 1024,
	});
	const file = `${directory}/${name}.log`;
	await writeFile(
		path.join(root, file),
		`${result.stdout ?? ""}${result.stderr ?? ""}`,
	);
	artifacts.push(file);
	(report.commands as unknown[]).push({
		name,
		argv,
		cwd: isolated ? "candidate" : "source",
		exitCode: result.status,
		durationMs: Date.now() - started,
		log: file,
	});
	if (result.status !== 0) throw new Error(`Command failed; see ${file}`);
}

try {
	await check("runtime-preset-and-localized-branding", async () => {
		for (const name of [
			"foundation",
			"commercial-local",
			"commercial-provider",
		]) {
			const env = templatePresetEnvironment(name);
			validateTemplatePreset(name, env);
			for (const locale of ["en", "es"] as const) {
				assert.deepEqual(publicConfig({ ...env, DEFAULT_LOCALE: locale }), {
					appName: "Northstar Work",
					defaultLocale: locale,
				});
				const email = await renderRuntimeEmail(locale, {
					APP_NAME: env.APP_NAME,
				});
				assert.ok(email.text.includes("Northstar Work"));
				assert.ok(email.html.includes(`lang="${locale}"`));
			}
		}
		await command("preset-negative-controls", [
			"bun",
			"run",
			"test:unit",
			"scripts/phase8/template.test.ts",
			"packages/email/src/email.test.ts",
		]);
	});
	await check("disposable-rename-interruption-resume-repeat", async () => {
		const names = await copyTemplateFixture(root, candidate);
		assert.ok(!names.includes(".env"));
		const custom = await seedTemplateCustomization(candidate);
		names.push(custom.name);
		const before = await templateHashes(candidate, names);
		assert.equal(await initializeTemplateEnvironment(candidate), true);
		const environment =
			'# Existing downstream configuration must survive resume.\nAPP_NAME="Existing product"\n';
		await writeFile(path.join(candidate, ".env"), environment);
		const checkpoint = await adoptTemplateFixture(candidate, names, 7);
		assert.equal(checkpoint.length, 7);
		const checkpointHashes = await templateHashes(candidate, names);
		const resumed = await adoptTemplateFixture(candidate, names);
		assert.ok(resumed.length > 0);
		for (const name of checkpoint)
			assert.equal(
				(await templateHashes(candidate, [name]))[name],
				checkpointHashes[name],
			);
		const after = await templateHashes(candidate, names);
		assert.deepEqual(await adoptTemplateFixture(candidate, names), []);
		assert.deepEqual(await templateHashes(candidate, names), after);
		assert.equal(await initializeTemplateEnvironment(candidate), false);
		assert.equal(
			await readFile(path.join(candidate, ".env"), "utf8"),
			environment,
		);
		assert.equal(
			await readFile(path.join(candidate, custom.name), "utf8"),
			custom.content,
		);
		const protectedNames = names.filter(
			(name) =>
				/^(spikes\/phase0\/|docs\/phase[0-7]\/|packages\/db\/migrations\/|packages\/authz\/src\/fixtures\/|evaluations\/|\.agents\/)/.test(
					name,
				) || name === "packages/authz/src/model.ts",
		);
		assert.ok(
			protectedNames.some((name) =>
				name.endsWith("0025_backoffice_identity.sql"),
			),
		);
		for (const name of protectedNames) assert.equal(after[name], before[name]);
		const manifest = JSON.parse(
			await readFile(path.join(candidate, "package.json"), "utf8"),
		);
		assert.equal(manifest.name, "northstar-work");
		assert.ok(manifest.scripts.build.includes("@northstar-work/web"));
		assert.ok(
			(await readFile(path.join(candidate, ".env.example"), "utf8")).includes(
				'APP_NAME="Northstar Work"',
			),
		);
		for (const name of names.filter((name) =>
			/^(apps|packages)\/.+\/package.json$/.test(name),
		))
			assert.ok(
				JSON.parse(
					await readFile(path.join(candidate, name), "utf8"),
				).name.startsWith("@northstar-work/"),
			);
		report.adoption = {
			inventoriedFiles: names.length,
			checkpoint,
			resumed,
			protectedFiles: protectedNames.length,
			sourceHashes: before,
			adoptedHashes: after,
			customSourcePreserved: true,
			environmentPreserved: true,
			completedRepeatChangedFiles: 0,
		};
	});
	await check("retained-agent-evidence-applicability", async () => {
		report.skillEvidence = await auditTemplateSkillEvidence(root);
	});
	if (!smoke) {
		await check("renamed-frozen-install", () =>
			command(
				"renamed-install",
				["bun", "install", "--frozen-lockfile"],
				candidate,
				true,
			),
		);
		await check("renamed-production-build", () =>
			command("renamed-build", ["bun", "run", "build"], candidate, true),
		);
		await check("renamed-localized-runtime-pages", async () => {
			const log = `${directory}/renamed-runtime.log`;
			artifacts.push(log);
			report.runtimeBranding = await verifyRenamedTemplateServer(
				candidate,
				path.join(root, log),
			);
		});
		await check("renamed-strict-types", () =>
			command(
				"renamed-typecheck",
				["bun", "run", "typecheck"],
				candidate,
				true,
			),
		);
		await check("renamed-localized-email", () =>
			command(
				"renamed-email",
				["bun", "run", "test:unit", "packages/email/src/email.test.ts"],
				candidate,
				true,
			),
		);
		await check("skill-contracts-and-real-service-setup", () =>
			command("skills-check", ["bun", "run", "skills:check"]),
		);
	} else
		await check("static-skill-contracts", () =>
			command("skills-static", ["bun", "run", "skills:check", "--static"]),
		);
	await check("source-unchanged-during-verification", async () => {
		const finishedSource = await evidenceSource();
		assert.equal(finishedSource.commit, source.commit);
		assert.equal(finishedSource.fingerprint, source.fingerprint);
	});
} catch (error) {
	console.error(
		error instanceof Error ? error.message : "Template verification failed",
	);
	process.exitCode = 1;
} finally {
	const file = `${directory}/report.json`;
	await writeFile(
		path.join(root, file),
		`${JSON.stringify({ ...report, checks }, null, 2)}\n`,
	);
	artifacts.push(file);
	const receipt = await writeEvidence(
		{
			gate: smoke ? "template-smoke" : "template",
			preset: "commercial-local",
			startedAt,
			outcome:
				checks.length > 0 && checks.every((item) => item.passed)
					? "passed"
					: "failed",
			source,
			checks,
			limitations: [
				"Provider credentials are synthetic configuration inputs only",
				"Historical agent trials retain original source and task scope",
				...(smoke
					? ["Smoke omits renamed build and real-service skill boundaries"]
					: []),
			],
		},
		artifacts,
	);
	console.info(`Evidence: ${receipt}`);
}
