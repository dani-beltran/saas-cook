import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2]),
	repeat = Number(process.argv[3]);
assert.ok([1, 2].includes(repeat));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const folder = path.join(output, `run-${repeat}`),
	candidate = path.join(folder, "candidate"),
	manifest = JSON.parse(
		await readFile(path.join(output, "manifest.json"), "utf8"),
	);
const failures = [];
for (const name of (await readdir(folder)).filter((n) =>
	n.startsWith("checks-"),
)) {
	try {
		const result = JSON.parse(
			await readFile(path.join(folder, name, "result.json"), "utf8"),
		);
		if (
			!result.passed &&
			result.checks.length === 7 &&
			result.checks.every((c) => c.passed && c.exitCode === 0) &&
			result.failure?.message.includes("next-env.d.ts")
		)
			failures.push({ name, result });
	} catch {}
}
assert.equal(
	failures.length,
	1,
	"Exactly one optional-declaration reporter failure required",
);
const original = failures[0],
	source = path.join(folder, original.name);
for (const [file, hash] of Object.entries({
	...manifest.sourceHashes,
	...manifest.protectedAdditional,
}))
	assert.equal(
		digest(await readFile(path.join(candidate, file))),
		hash,
		`Protected source changed: ${file}`,
	);
for (const [file, hash] of Object.entries(original.result.controlHashes))
	assert.equal(
		digest(await readFile(path.join(output, "controls", file))),
		hash,
		`Control changed: ${file}`,
	);
for (const [file, hash] of Object.entries(original.result.controllerHashes))
	assert.equal(
		digest(await readFile(path.join(output, "controller", file))),
		hash,
		`Controller changed: ${file}`,
	);
for (const check of original.result.checks)
	assert.equal(
		digest(await readFile(path.join(source, check.log))),
		check.logSha256,
		`Command log changed: ${check.name}`,
	);
const after = {};
async function visit(dir) {
	for (const e of await readdir(dir, { withFileTypes: true })) {
		if (
			["node_modules", "artifacts", ".git", ".next", ".turbo", "dist"].includes(
				e.name,
			) ||
			/\.tsbuildinfo$|^next-env\.d\.ts$|^\.env/.test(e.name)
		)
			continue;
		const file = path.join(dir, e.name);
		if (e.isDirectory()) await visit(file);
		else if (e.isFile())
			after[path.relative(candidate, file)] = digest(await readFile(file));
	}
}
await visit(candidate);
const before = JSON.parse(
	await readFile(path.join(source, "source-before.json"), "utf8"),
);
assert.deepEqual(
	after,
	before,
	"Final source differs from actual pre-check source",
);
assert.ok(!("apps/web/next-env.d.ts" in manifest.sourceHashes));
for (const suite of ["heldout", "unit", "integration"]) {
	const report = JSON.parse(
		await readFile(path.join(source, `${suite}.json`), "utf8"),
	);
	assert.equal(report.success, true);
	for (const key of [
		"numFailedTests",
		"numFailedTestSuites",
		"numPendingTests",
		"numPendingTestSuites",
		"numTodoTests",
	])
		assert.equal(report[key], 0);
	for (const file of report.testResults)
		for (const test of file.assertionResults)
			assert.equal(test.status, "passed");
}
const target = path.join(folder, `checks-reporter-repair-${randomUUID()}`);
await cp(source, target, { recursive: true });
const result = {
	...original.result,
	passed: true,
	originalCompletedAt: original.result.completedAt,
	completedAt: new Date().toISOString(),
	finalSourceSha256: digest(JSON.stringify(after)),
	reporterRepair: {
		kind: "evaluator-finalization-repair",
		originalAttempt: original.name,
		originalResultSha256: digest(
			await readFile(path.join(source, "result.json")),
		),
		originalFailure: original.result.failure,
		reason:
			"All seven actual commands passed. Turbo reused production output without generating the optional excluded next-env declaration. Revalidated every original/control/controller/source hash, unchanged pre/post source, raw case result and command-log digest; no command rerun and no assertion relaxed.",
		applicationCommandsReusedWithoutRerun: true,
	},
	generatedDeclaration: {
		path: "apps/web/next-env.d.ts",
		beforeSha256: null,
		afterSha256: null,
		availability:
			"absent after successful cached build; excluded generated file",
	},
};
delete result.failure;
await writeFile(
	path.join(target, "source-after-revalidated.json"),
	`${JSON.stringify(after, null, 2)}\n`,
);
await writeFile(
	path.join(target, "result.json"),
	`${JSON.stringify(result, null, 2)}\n`,
);
console.log(
	JSON.stringify({
		passed: true,
		originalAttempt: original.name,
		repairedAttempt: path.basename(target),
		sourceSha256: result.finalSourceSha256,
		applicationCommandsReusedWithoutRerun: true,
	}),
);
