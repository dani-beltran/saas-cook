import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	readFreshReport,
	verifyPlaywrightReport,
	verifyVitestReport,
} from "./reports.ts";

const taskId = process.argv[2];
assert.match(taskId ?? "", /^phase5-task-0[1-5]$/);
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Evaluator-owned command, outside cached application tasks.
const candidate = process.env.PHASE4_CANDIDATE_ROOT;
assert.ok(candidate, "Disposable candidate required");
const evaluator = path.dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(
	await readFile(path.join(evaluator, "baseline.json"), "utf8"),
);
const manifest = JSON.parse(
	await readFile(path.join(evaluator, "manifest.json"), "utf8"),
);
const spec = manifest.tasks.find((t) => t.id === taskId).checks[0];
const output = path.join(
	candidate,
	"artifacts/phase5-heldout",
	taskId,
	randomUUID(),
);
await mkdir(output, { recursive: true });
const digest = (data) => createHash("sha256").update(data).digest("hex");
async function integrity() {
	for (const [file, hash] of Object.entries(baseline.protectedHashes))
		assert.equal(
			digest(await readFile(path.join(candidate, file))),
			hash,
			`Protected baseline changed: ${file}`,
		);
}
function run(argv, extraEnv = {}) {
	const result = spawnSync(argv[0], argv.slice(1), {
		cwd: candidate,
		env: { ...process.env, ...extraEnv },
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		timeout: 900000,
	});
	process.stdout.write(result.stdout ?? "");
	process.stderr.write(result.stderr ?? "");
	assert.equal(result.status, 0, `Failed: ${argv.join(" ")}`);
}
async function heldout() {
	const staged = path.join(output, "tasks.integration.test.ts"),
		report = path.join(output, "heldout.json");
	await cp(path.join(evaluator, "tasks.integration.test.ts"), staged);
	const config = path.join(output, "vitest.config.mjs");
	await writeFile(
		config,
		`export default ${JSON.stringify({ test: { include: [staged], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false, reporters: ["default", "json"], outputFile: { json: report } } })};\n`,
	);
	const start = Date.now();
	run([
		process.execPath,
		"node_modules/vitest/vitest.mjs",
		"run",
		"--config",
		config,
		"-t",
		taskId,
	]);
	verifyVitestReport(
		await readFreshReport(report, start),
		output,
		baseline.heldout.filter((t) => t.name.startsWith(`${taskId} `)),
		`${taskId} `,
	);
}
async function browser() {
	await cp(
		path.join(evaluator, "billing.spec.ts"),
		path.join(output, "billing.spec.ts"),
	);
	await cp(
		path.join(candidate, "tests/e2e/dashboard-helpers.ts"),
		path.join(output, "dashboard-helpers.ts"),
	);
	const config = path.join(output, "playwright.config.mjs"),
		report = path.join(output, "browser.json");
	await writeFile(
		config,
		`import base from ${JSON.stringify(path.join(candidate, "playwright.config.ts"))};\nexport default {...base,testDir:${JSON.stringify(output)},globalSetup:${JSON.stringify(path.join(candidate, "tests/e2e/setup.ts"))},testMatch:"billing.spec.ts",retries:0};\n`,
	);
	const start = Date.now();
	run(
		[
			process.execPath,
			"node_modules/@playwright/test/cli.js",
			"test",
			"--config",
			config,
			"--retries=0",
			"--reporter=list,json",
		],
		{
			PLAYWRIGHT_JSON_OUTPUT_FILE: report,
			E2E_REPORT_GROUP: randomUUID(),
		},
	);
	verifyPlaywrightReport(await readFreshReport(report, start), output, [
		{
			file: "billing.spec.ts",
			name: "phase5 usage copy, keyboard, denied, pending, outage and conflict states",
		},
	]);
}
try {
	await integrity();
	await heldout();
	if (taskId === "phase5-task-04") await browser();
	await integrity();
	console.log(
		`PHASE4_RESULT=${JSON.stringify({ taskId, checkId: spec.id, cases: spec.caseIds.map((id) => ({ id, status: "passed" })) })}`,
	);
} catch (error) {
	console.error(error);
	console.log(
		`PHASE4_RESULT=${JSON.stringify({ taskId, checkId: spec.id, cases: spec.caseIds.map((id) => ({ id, status: "failed" })) })}`,
	);
	process.exitCode = 1;
}
