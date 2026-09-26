import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFreshReport, verifyVitestReport } from "./reports.ts";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: Controller-owned evaluation, never a Turbo-cached task.
const candidate = process.env.PHASE4_CANDIDATE_ROOT;
assert.ok(candidate, "A disposable candidate is required");
const evaluator = path.dirname(fileURLToPath(import.meta.url));
const required = JSON.parse(
	await readFile(path.join(evaluator, "baseline-cases.json"), "utf8"),
);
const output = path.join(
	candidate,
	"artifacts/phase4-heldout/unit",
	randomUUID(),
);
await mkdir(output, { recursive: true });
const reportFile = path.join(output, "results.json");
const startedAt = Date.now();
const result = spawnSync(
	"bun",
	[
		"run",
		"test:unit",
		"--reporter=default",
		"--reporter=json",
		`--outputFile.json=${reportFile}`,
	],
	{
		cwd: candidate,
		env: process.env,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		timeout: 15 * 60_000,
	},
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
assert.equal(result.status, 0, "Candidate unit command failed");
const cases = verifyVitestReport(
	await readFreshReport(reportFile, startedAt),
	candidate,
	required.groups.unit,
);
console.log(`APPLICATION_UNIT_PASSED=${cases.length}`);
