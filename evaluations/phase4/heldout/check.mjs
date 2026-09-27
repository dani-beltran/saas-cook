import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	readFreshReport,
	verifyPlaywrightReports,
	verifyVitestReport,
} from "./reports.ts";

const taskId = process.argv[2];
assert.match(taskId ?? "", /^task-\d{2}$/);
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Controller-owned evaluation, never a Turbo-cached task.
const candidate = process.env.PHASE4_CANDIDATE_ROOT;
assert.ok(candidate, "A disposable candidate is required");
const evaluator = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(
	candidate,
	"artifacts",
	"phase4-heldout",
	taskId,
	randomUUID(),
);
const baseline = JSON.parse(
	await readFile(path.join(evaluator, "baseline-cases.json"), "utf8"),
);
await mkdir(output, { recursive: true });

function run(argv, extraEnv = {}) {
	const result = spawnSync(argv[0], argv.slice(1), {
		cwd: candidate,
		env: { ...process.env, ...extraEnv, PHASE4_CANDIDATE_ROOT: candidate },
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		timeout: 15 * 60_000,
	});
	process.stdout.write(result.stdout ?? "");
	process.stderr.write(result.stderr ?? "");
	assert.equal(result.status, 0, `Check failed: ${argv.join(" ")}`);
}

async function vitest(group, argv, extraEnv = {}) {
	const reportFile = path.join(output, `${group}.json`);
	const startedAt = Date.now();
	run(
		[
			...argv,
			"--reporter=default",
			"--reporter=json",
			`--outputFile.json=${reportFile}`,
		],
		extraEnv,
	);
	const cases = verifyVitestReport(
		await readFreshReport(reportFile, startedAt),
		candidate,
		baseline.groups[group],
	);
	console.log(`VERIFIED_SUITE=${group}:${cases.length}`);
}

async function browser(group, commands, reportRoot = candidate) {
	const reports = [];
	for (const [index, argv] of commands.entries()) {
		const reportFile = path.join(output, `${group}-${index}.json`);
		const startedAt = Date.now();
		run([...argv, "--reporter=list,json"], {
			PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
			E2E_REPORT_GROUP: `${path.basename(output)}-${group}-${index}`,
		});
		reports.push(await readFreshReport(reportFile, startedAt));
	}
	const cases = verifyPlaywrightReports(
		reports,
		reportRoot,
		baseline.groups[group],
	);
	console.log(`VERIFIED_SUITE=${group}:${cases.length}`);
}

async function heldout() {
	// Stage evaluator-owned tests only after the authoring agent has stopped.
	// Canonical expectations remain outside the candidate and are hash-verified
	// by the controller before/after execution. Artifacts never enter source diffs.
	const staged = path.join(output, "tasks.integration.test.ts");
	await cp(path.join(evaluator, "tasks.integration.test.ts"), staged);
	const config = path.join(output, "vitest.config.mjs");
	await writeFile(
		config,
		`export default ${JSON.stringify({
			test: {
				include: [staged],
				testTimeout: 30_000,
				hookTimeout: 60_000,
				fileParallelism: false,
				reporters: ["default", "json"],
				outputFile: { json: path.join(output, "results.json") },
			},
		})};\n`,
	);
	const startedAt = Date.now();
	run([
		process.execPath,
		"node_modules/vitest/vitest.mjs",
		"run",
		"--config",
		config,
		"-t",
		taskId,
	]);
	const required = baseline.groups.heldout.filter((entry) =>
		entry.name.startsWith(`${taskId} `),
	);
	verifyVitestReport(
		await readFreshReport(path.join(output, "results.json"), startedAt),
		output,
		required,
		`${taskId} `,
	);
}

async function sourceHashes() {
	const files = {};
	async function visit(directory, relative = "") {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (
				[
					"node_modules",
					".git",
					".next",
					".turbo",
					"artifacts",
					"dist",
					"test-results",
					"playwright-report",
				].includes(entry.name) ||
				entry.name.endsWith(".tsbuildinfo") ||
				entry.name === "WORK-REPORT.md" ||
				entry.name === "next-env.d.ts"
			)
				continue;
			const local = path.join(relative, entry.name);
			if (entry.isDirectory())
				await visit(path.join(directory, entry.name), local);
			else if (entry.isFile())
				files[local] = createHash("sha256")
					.update(await readFile(path.join(directory, entry.name)))
					.digest("hex");
		}
	}
	await visit(candidate);
	return Object.fromEntries(Object.entries(files).sort());
}

try {
	const history = JSON.parse(
		await readFile(path.join(evaluator, "migration-history.json"), "utf8"),
	);
	for (const [file, digest] of Object.entries(history))
		assert.equal(
			createHash("sha256")
				.update(await readFile(path.join(candidate, file)))
				.digest("hex"),
			digest,
			`Applied history changed: ${file}`,
		);
	if (
		["task-02", "task-03", "task-04", "task-05", "task-06", "task-07"].includes(
			taskId,
		)
	)
		await heldout();
	if (taskId === "task-01") {
		const manifest = JSON.parse(
			await readFile(path.join(candidate, "package.json"), "utf8"),
		);
		assert.equal(manifest.name, "northstar-tasks");
		await vitest("project", [
			"bun",
			"run",
			"test:integration",
			"packages/api/src/resources.integration.test.ts",
			"packages/db/src/migrations.integration.test.ts",
		]);
	}
	if (taskId === "task-04") {
		for (const [file, digest] of Object.entries(
			baseline.historicalSourceHashes,
		))
			assert.equal(
				createHash("sha256")
					.update(await readFile(path.join(candidate, file)))
					.digest("hex"),
				digest,
				`Historical regression changed: ${file}`,
			);
		await vitest("authz", ["bun", "run", "test:integration", "packages/authz"]);
		// Reuse the actual retained projection/context fault suites, without
		// running any benchmark or enabling unrelated historical providers.
		const { Pool } = createRequire(path.join(candidate, "package.json"))("pg");
		const database = `phase4_historical_${randomUUID().replaceAll("-", "")}`;
		const admin = new Pool({
			connectionString:
				"postgres://postgres:local_phase1@127.0.0.1:55433/postgres",
			max: 1,
		});
		try {
			await admin.query(`CREATE DATABASE "${database}"`);
			await vitest(
				"historical",
				[
					"bun",
					"run",
					"phase0:test",
					"spikes/phase0/authz/integration.test.ts",
					"spikes/phase0/authz/contextual.test.ts",
				],
				{
					PHASE0_INTEGRATION: "1",
					AUTHZ_DATABASE_URL: `postgres://postgres:local_phase1@127.0.0.1:55433/${database}`,
					OPENFGA_URL: "http://127.0.0.1:18081",
				},
			);
		} finally {
			await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
			await admin.end();
		}
	}
	if (taskId === "task-06")
		await vitest("capacity", [
			"bun",
			"run",
			"test:integration",
			"packages/db/src/resources.integration.test.ts",
		]);
	if (taskId === "task-08") {
		assert.equal(
			await readFile(path.join(candidate, "CUSTOM-NOTES.md"), "utf8"),
			"Preserve this product note.\n",
		);
		const before = JSON.parse(
			await readFile(path.join(candidate, "..", "repeat-before.json"), "utf8"),
		);
		assert.deepEqual(
			await sourceHashes(),
			before,
			"Repeated completed request changed source",
		);
	}
	if (taskId === "task-09") {
		await heldout();
		// Each spec needs its own disposable installation, as in the application
		// browser runner. CLI reporter/retry options otherwise bypass that split
		// and spend one shared authentication throttle budget across all specs.
		const specs = (await readdir(path.join(candidate, "tests/e2e")))
			.filter((file) => file.endsWith(".spec.ts"))
			.sort();
		await browser(
			"browser",
			specs.map((spec) => [
				"bun",
				"run",
				"test:e2e",
				`tests/e2e/${spec}`,
				"--retries=0",
			]),
		);
		await cp(
			path.join(evaluator, "directory.spec.ts"),
			path.join(output, "directory.spec.ts"),
		);
		const config = path.join(output, "playwright.config.mjs");
		await writeFile(
			config,
			`import base from ${JSON.stringify(path.join(candidate, "playwright.config.ts"))};\nexport default {...base,testDir:${JSON.stringify(output)},globalSetup:${JSON.stringify(path.join(candidate, "tests/e2e/setup.ts"))},testMatch:"directory.spec.ts"};\n`,
		);
		await browser(
			"directory",
			[
				[
					process.execPath,
					"node_modules/@playwright/test/cli.js",
					"test",
					"--config",
					config,
					"--retries=0",
				],
			],
			output,
		);
	}
	if (taskId === "task-10") {
		// The controller retains independent failure evidence and the review
		// agent's findings; implementation self-report alone cannot pass.
		const review = JSON.parse(
			await readFile(
				path.join(candidate, "..", "review-assessment.json"),
				"utf8",
			),
		);
		assert.equal(review.evaluator, "independent-controller");
		const controller = path.join(candidate, "..");
		assert.equal(
			createHash("sha256")
				.update(await readFile(path.join(controller, review.transcript)))
				.digest("hex"),
			review.transcriptSha256,
		);
		assert.equal(
			createHash("sha256")
				.update(await readFile(path.join(controller, review.seededSource)))
				.digest("hex"),
			review.seededSourceSha256,
		);
		for (const name of ["missing-rls", "dto-leak", "missing-permission"]) {
			const finding = review.findings.find((entry) => entry.case === name);
			assert.equal(finding?.detected, true);
			assert.ok(
				finding?.sourceFile &&
					finding?.behaviorEvidence &&
					finding?.agentFinding,
			);
			assert.notEqual(
				finding.testExitCode,
				0,
				"A seeded defect must fail its behavioral check",
			);
			assert.equal(
				createHash("sha256")
					.update(
						await readFile(path.join(controller, finding.behaviorEvidence)),
					)
					.digest("hex"),
				finding.behaviorEvidenceSha256,
			);
		}
		assert.ok(review.transcriptSha256 && review.seededSourceSha256);
	}
	console.log(
		`PHASE4_RESULT=${JSON.stringify({ taskId, checkId: `behavior-${taskId.slice(-2)}`, cases: [{ id: taskId, status: "passed" }] })}`,
	);
} catch (error) {
	console.error(error);
	console.log(
		`PHASE4_RESULT=${JSON.stringify({ taskId, checkId: `behavior-${taskId.slice(-2)}`, cases: [{ id: taskId, status: "failed" }] })}`,
	);
	process.exitCode = 1;
}
