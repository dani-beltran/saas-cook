import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2]),
	repeat = Number(process.argv[3]);
assert.ok([1, 2].includes(repeat));
const baselinePath = path.join(output, "regression-census/baseline-cases.json");
const baselineBytes = await readFile(baselinePath),
	baseline = JSON.parse(baselineBytes);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const folder = path.join(output, `run-${repeat}`),
	candidate = path.join(folder, "candidate");
const results = [];
for (const name of (await readdir(folder)).filter((n) =>
	n.startsWith("checks-"),
)) {
	try {
		const result = JSON.parse(
			await readFile(path.join(folder, name, "result.json"), "utf8"),
		);
		if (result.passed) results.push({ name, ...result });
	} catch {}
}
results.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
const final = results.at(-1);
assert.ok(final, "Complete passing application/heldout attempt required");
const result = {
	version: 1,
	repeat,
	checkedAt: new Date().toISOString(),
	baselineSha256: digest(baselineBytes),
	candidateFinalSourceSha256: final.finalSourceSha256,
	checkAttempt: final.name,
	caseCounts: {},
	passed: false,
};
try {
	for (const [file, hash] of Object.entries(baseline.sourceHashes))
		assert.equal(
			digest(await readFile(path.join(candidate, file))),
			hash,
			`Original test source changed: ${file}`,
		);
	for (const suite of ["unit", "integration"]) {
		const bytes = await readFile(
				path.join(folder, final.name, `${suite}.json`),
			),
			report = JSON.parse(bytes);
		assert.equal(report.success, true);
		for (const key of [
			"numFailedTests",
			"numFailedTestSuites",
			"numPendingTests",
			"numPendingTestSuites",
			"numTodoTests",
		])
			assert.equal(report[key], 0, `${suite} ${key}`);
		const actual = report.testResults.flatMap((file) =>
			file.assertionResults.map((test) => ({
				file: path.relative(candidate, file.name),
				name: test.fullName,
				status: test.status,
			})),
		);
		assert.equal(actual.length, report.numTotalTests);
		const counts = new Map();
		for (const test of actual) {
			assert.equal(test.status, "passed");
			const key = JSON.stringify([test.file, test.name]);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		for (const test of baseline[suite]) {
			const key = JSON.stringify([test.file, test.name]);
			assert.ok(
				(counts.get(key) ?? 0) > 0,
				`Missing original case: ${suite} ${key}`,
			);
			counts.set(key, counts.get(key) - 1);
		}
		result.caseCounts[suite] = {
			required: baseline[suite].length,
			actual: actual.length,
			reportSha256: digest(bytes),
		};
	}
	result.passed = true;
} catch (error) {
	result.failure = { name: error.name, message: error.message };
}
await writeFile(
	path.join(output, `regression-census/run-${repeat}.json`),
	`${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
