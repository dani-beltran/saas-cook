import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFreshReport, verifyVitestReport } from "./reports.ts";

const mode = process.argv[2];
assert.ok(["unit", "integration", "check", "knip"].includes(mode));
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Evaluator-owned command, outside cached application tasks.
const candidate = process.env.PHASE4_CANDIDATE_ROOT;
assert.ok(candidate);
const baseline = JSON.parse(
	await readFile(
		path.join(path.dirname(fileURLToPath(import.meta.url)), "baseline.json"),
		"utf8",
	),
);
for (const [file, hash] of Object.entries(baseline.protectedHashes))
	assert.equal(
		createHash("sha256")
			.update(await readFile(path.join(candidate, file)))
			.digest("hex"),
		hash,
		`Protected baseline changed: ${file}`,
	);
if (["check", "knip"].includes(mode)) {
	const run = spawnSync("bun", ["run", mode], {
		cwd: candidate,
		env: process.env,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		timeout: 900000,
	});
	process.stdout.write(run.stdout ?? "");
	process.stderr.write(run.stderr ?? "");
	assert.equal(run.status, 0, `Candidate ${mode} failed`);
	console.log(`APPLICATION_${mode.toUpperCase()}_PASSED`);
	process.exit(0);
}
const output = path.join(
	candidate,
	"artifacts/phase5-heldout/application",
	randomUUID(),
);
await mkdir(output, { recursive: true });
const report = path.join(output, "results.json"),
	startedAt = Date.now();
const run = spawnSync(
	"bun",
	[
		"run",
		`test:${mode}`,
		"--reporter=default",
		"--reporter=json",
		`--outputFile.json=${report}`,
	],
	{
		cwd: candidate,
		env: process.env,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		timeout: 900000,
	},
);
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
assert.equal(run.status, 0, `Candidate ${mode} failed`);
const cases = verifyVitestReport(
	await readFreshReport(report, startedAt),
	candidate,
	baseline[mode],
);
console.log(`APPLICATION_${mode.toUpperCase()}_PASSED=${cases.length}`);
