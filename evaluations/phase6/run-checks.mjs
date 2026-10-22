import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	access,
	cp,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2]);
const repeat = Number(process.argv[3]);
const mailGate = process.argv[4] ? path.resolve(process.argv[4]) : null;
assert.ok([1, 2].includes(repeat));
const candidate = path.join(output, `run-${repeat}`, "candidate");
const manifest = JSON.parse(
	await readFile(path.join(output, "manifest.json"), "utf8"),
);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const attempt = path.join(output, `run-${repeat}`, `checks-${randomUUID()}`);
await mkdir(attempt, { recursive: true });
const result = {
	version: 1,
	phase: 6,
	repeat,
	startedAt: new Date().toISOString(),
	candidate,
	sourceSha256: manifest.sourceSha256,
	controlVersion: manifest.controlVersion,
	controlHashes: manifest.controlHashes,
	controllerVersion: manifest.controllerVersion,
	controllerHashes: manifest.controllerHashes,
	checks: [],
};
async function integrity() {
	for (const [file, hash] of Object.entries(manifest.controllerHashes ?? {}))
		assert.equal(
			digest(await readFile(path.join(output, "controller", file))),
			hash,
			`Controller changed: ${file}`,
		);
	for (const [file, hash] of Object.entries({
		...manifest.sourceHashes,
		...manifest.protectedAdditional,
	}))
		assert.equal(
			digest(await readFile(path.join(candidate, file))),
			hash,
			`Protected source changed: ${file}`,
		);
	for (const [file, hash] of Object.entries(manifest.controlHashes))
		assert.equal(
			digest(await readFile(path.join(output, "controls", file))),
			hash,
			`Control changed: ${file}`,
		);
}
async function snapshot(dir) {
	const hashes = {};
	async function visit(folder) {
		for (const entry of await readdir(folder, { withFileTypes: true })) {
			if (
				[
					"node_modules",
					"artifacts",
					".git",
					".next",
					".turbo",
					"dist",
				].includes(entry.name) ||
				/\.tsbuildinfo$|^next-env\.d\.ts$|^\.env/.test(entry.name)
			)
				continue;
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) await visit(file);
			else if (entry.isFile())
				hashes[path.relative(dir, file)] = digest(await readFile(file));
		}
	}
	await visit(dir);
	return hashes;
}
function run(name, argv) {
	const start = Date.now();
	const child = spawnSync(argv[0], argv.slice(1), {
		cwd: candidate,
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			LANG: "en_US.UTF-8",
			CI: "1",
			NODE_ENV: argv.includes("build") ? "production" : "test",
		},
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		timeout: 1800000,
	});
	const log = `${name}.log`;
	return writeFile(
		path.join(attempt, log),
		`${child.stdout ?? ""}\n${child.stderr ?? ""}`,
	).then(() => {
		const check = {
			name,
			argv,
			exitCode: child.status,
			signal: child.signal,
			durationMs: Date.now() - start,
			log,
			logSha256: digest(`${child.stdout ?? ""}\n${child.stderr ?? ""}`),
			passed: child.status === 0,
		};
		result.checks.push(check);
		assert.equal(child.status, 0, `Failed ${name}`);
	});
}
async function verifyReport(report, requiredFiles = []) {
	const value = JSON.parse(await readFile(report, "utf8"));
	assert.equal(value.success, true);
	assert.equal(value.numFailedTests, 0);
	assert.equal(value.numPendingTests, 0);
	assert.equal(value.numTodoTests, 0);
	assert.equal(value.numPendingTestSuites, 0);
	const cases = value.testResults.flatMap((s) =>
		s.assertionResults.map((t) => ({
			file: path.relative(candidate, s.name),
			name: t.fullName,
			status: t.status,
		})),
	);
	assert.ok(cases.length);
	assert.equal(cases.length, value.numTotalTests);
	for (const test of cases) assert.equal(test.status, "passed", test.name);
	for (const file of requiredFiles)
		assert.ok(
			cases.some((t) => t.file === file),
			`Missing baseline suite: ${file}`,
		);
	return cases;
}
try {
	await integrity();
	const before = await snapshot(candidate);
	for (const file of Object.keys(before).filter((file) =>
		file.startsWith("packages/db/migrations/"),
	))
		assert.ok(
			file in manifest.sourceHashes,
			`Unexpected new migration: ${file}`,
		);
	await writeFile(
		path.join(attempt, "source-before.json"),
		JSON.stringify(before, null, 2),
	);
	const staged = path.join(candidate, "artifacts/phase6-heldout/test");
	await mkdir(staged, { recursive: true });
	for (const file of [
		"workflows.integration.test.ts",
		"team-restore.integration.test.ts",
		"epoch-response.integration.test.ts",
	])
		await cp(path.join(output, "controls", file), path.join(staged, file));
	const heldoutReport = path.join(attempt, "heldout.json");
	const config = path.join(staged, "vitest.config.mjs");
	await writeFile(
		config,
		`export default ${JSON.stringify({ test: { include: [path.join(staged, "*.integration.test.ts")], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false, reporters: ["default", "json"], outputFile: { json: heldoutReport } } })};\n`,
	);
	await run("heldout", [
		process.execPath,
		"node_modules/vitest/vitest.mjs",
		"run",
		"--config",
		config,
	]);
	result.heldout = await verifyReport(heldoutReport);
	const required = [
		"phase6-task-01 data-job-replay-and-strict-input",
		"phase6-task-02 discovery-current-authority-and-redaction",
		"phase6-task-02 activity-current-authority-and-tenant",
		"phase6-task-03 departure-preview-replay-and-continuity",
		"phase6-task-04 authoritative-analytics-preferences",
		"phase6-task-05 five-observable-seeded-defects-and-diagnosis",
		"phase6-preservation customized localized support behavior",
		"phase6-task-04 full backup team membership and credential revocation revalidation",
		"phase6-task-04 denies a delayed old-epoch real FGA allow after independent recovery rotation",
	];
	for (const name of required)
		assert.ok(
			result.heldout.some((t) => t.name === name),
			`Missing ${name}`,
		);
	for (const command of ["check", "typecheck", "knip"])
		await run(command, ["bun", "run", command]);
	for (const suite of ["unit", "integration"]) {
		let mailLock;
		if (suite === "integration") {
			if (mailGate) {
				assert.ok(
					mailGate.startsWith(`${output}${path.sep}`),
					"Mail gate must be evaluator-owned",
				);
				await writeFile(
					path.join(attempt, "progress.json"),
					JSON.stringify({
						stage: "waiting-for-root-mail-consumers",
						mailGate,
						at: new Date().toISOString(),
					}),
				);
				const deadline = Date.now() + 3600000;
				while (true) {
					try {
						await access(mailGate);
						break;
					} catch (error) {
						if (error.code !== "ENOENT") throw error;
					}
					assert.ok(
						Date.now() < deadline,
						"Root mail consumers did not release gate",
					);
					await new Promise((resolve) => setTimeout(resolve, 5000));
				}
			}
			mailLock = path.join(output, "candidate-mail-lock");
			const deadline = Date.now() + 3600000;
			while (true) {
				try {
					await mkdir(mailLock);
					break;
				} catch (error) {
					if (error.code !== "EEXIST") throw error;
				}
				assert.ok(
					Date.now() < deadline,
					"Candidate mail consumer did not release lock",
				);
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
			await writeFile(
				path.join(mailLock, "owner.json"),
				JSON.stringify({
					repeat,
					pid: process.pid,
					at: new Date().toISOString(),
				}),
			);
		}
		try {
			const report = path.join(attempt, `${suite}.json`);
			await run(suite, [
				"bun",
				"run",
				`test:${suite}`,
				"--reporter=default",
				"--reporter=json",
				`--outputFile.json=${report}`,
			]);
			const requiredFiles = Object.keys(manifest.sourceHashes).filter((file) =>
				suite === "integration"
					? /^(apps|packages)\/.*\.integration\.test\.[tj]sx?$/.test(file)
					: /^(apps|packages|scripts\/phase[134])\/.*\.test\.[tj]sx?$/.test(
							file,
						) && !file.includes(".integration.test."),
			);
			result[suite] = await verifyReport(report, requiredFiles);
		} finally {
			if (mailLock) await rm(mailLock, { recursive: true });
		}
	}
	const generatedPath = path.join(candidate, "apps/web/next-env.d.ts");
	let generatedBefore;
	try {
		generatedBefore = await readFile(generatedPath);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await run("build", ["bun", "run", "build"]);
	let generatedAfter;
	try {
		generatedAfter = await readFile(generatedPath);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	result.generatedDeclaration = {
		path: "apps/web/next-env.d.ts",
		beforeSha256: generatedBefore ? digest(generatedBefore) : null,
		afterSha256: generatedAfter ? digest(generatedAfter) : null,
		restoredBaseline: Boolean(generatedBefore),
	};
	if (generatedAfter)
		await writeFile(path.join(attempt, "next-env-after.d.ts"), generatedAfter);
	if (generatedBefore) {
		await writeFile(
			path.join(attempt, "next-env-before.d.ts"),
			generatedBefore,
		);
		await writeFile(generatedPath, generatedBefore);
	}
	await integrity();
	const after = await snapshot(candidate);
	assert.deepEqual(after, before, "Candidate source changed during checks");
	result.finalSourceSha256 = digest(JSON.stringify(after));
	result.passed = true;
} catch (error) {
	result.passed = false;
	result.failure = { name: error.name, message: error.message };
}
result.completedAt = new Date().toISOString();
await writeFile(
	path.join(attempt, "result.json"),
	`${JSON.stringify(result, null, 2)}\n`,
);
console.log(
	JSON.stringify({
		attempt,
		passed: result.passed,
		checks: result.checks.map((c) => ({ name: c.name, passed: c.passed })),
		failure: result.failure,
	}),
);
if (!result.passed) process.exitCode = 1;
