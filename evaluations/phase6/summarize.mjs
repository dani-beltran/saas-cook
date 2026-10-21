import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2]);
const json = async (file) =>
	JSON.parse(await readFile(path.join(output, file), "utf8"));
const manifest = await json("manifest.json"),
	configuration = await json("agent-configuration.json");
const digest = (value) => createHash("sha256").update(value).digest("hex");
for (const [file, hash] of Object.entries(manifest.controlHashes))
	assert.equal(
		digest(await readFile(path.join(output, "controls", file))),
		hash,
		`Control changed: ${file}`,
	);
for (const [file, hash] of Object.entries(manifest.controllerHashes ?? {}))
	assert.equal(
		digest(await readFile(path.join(output, "controller", file))),
		hash,
		`Controller changed: ${file}`,
	);
const result = {
	version: 1,
	phase: 6,
	checkedAt: new Date().toISOString(),
	templateCommit: manifest.templateCommit,
	initialSourceSha256: manifest.sourceSha256,
	initialProtectedFiles: Object.keys(manifest.sourceHashes).length,
	protectedSupplementFiles: Object.keys(manifest.protectedAdditional).length,
	controlVersion: manifest.controlVersion,
	controlHashes: manifest.controlHashes,
	configuration,
	candidates: [],
	passed: false,
};
for (let repeat = 1; repeat <= 2; repeat++) {
	const folder = `run-${repeat}`;
	const names = await readdir(path.join(output, folder));
	const attempts = [];
	for (const name of names.filter((n) => n.startsWith("checks-"))) {
		try {
			const value = await json(`${folder}/${name}/result.json`);
			attempts.push({ path: `${folder}/${name}/result.json`, ...value });
		} catch {
			attempts.push({
				path: `${folder}/${name}/result.json`,
				passed: false,
				failure: { message: "Missing/incomplete attempt" },
			});
		}
	}
	const successful = attempts
		.filter((a) => a.passed)
		.sort((a, b) => a.completedAt.localeCompare(b.completedAt))
		.at(-1);
	const entry = {
		repeat,
		attempts: attempts.map((a) => ({
			path: a.path,
			passed: a.passed,
			failure: a.failure,
			checks: a.checks?.map((c) => ({
				name: c.name,
				passed: c.passed,
				exitCode: c.exitCode,
			})),
		})),
		passed: false,
	};
	try {
		assert.ok(successful, "No complete passing candidate check attempt");
		const before = await json(`${folder}/snapshot-before-repeat/source.json`),
			after = await json(`${folder}/snapshot-after-repeat/source.json`);
		assert.deepEqual(
			after.sourceHashes,
			before.sourceHashes,
			"Satisfied repeat changed source",
		);
		const checkpoint = await json(`${folder}/checkpoint-verified.json`);
		assert.equal(checkpoint.passed, true);
		const resume = await readFile(
				path.join(output, folder, "author-resume.jsonl"),
				"utf8",
			),
			repeatTranscript = await readFile(
				path.join(output, folder, "author-repeat.jsonl"),
				"utf8",
			);
		for (const transcript of [resume, repeatTranscript]) {
			const events = transcript
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			assert.ok(
				events.some((e) => e.type === "turn.completed"),
				"Missing completed actual agent turn",
			);
			assert.ok(
				!events.some((e) => e.type === "turn.failed" || e.type === "error"),
				"Agent attempt failed",
			);
		}
		assert.equal(
			successful.finalSourceSha256,
			digest(JSON.stringify(after.sourceHashes)),
			"Passing check source differs from final repeated source",
		);
		entry.sourceIdenticalRepeat = true;
		entry.preservedCheckpoint = true;
		entry.heldoutCases = successful.heldout.length;
		entry.unitCases = successful.unit.length;
		entry.integrationCases = successful.integration.length;
		entry.finalSourceSha256 = successful.finalSourceSha256;
		entry.finalCheck = successful.path;
		entry.transcripts = {
			resumeSha256: digest(resume),
			repeatSha256: digest(repeatTranscript),
		};
		entry.passed = true;
	} catch (error) {
		entry.failure = error.message;
	}
	result.candidates.push(entry);
}
result.passed =
	result.candidates.length === 2 && result.candidates.every((c) => c.passed);
await writeFile(
	path.join(output, "summary.json"),
	`${JSON.stringify(result, null, 2)}\n`,
);
console.log(
	JSON.stringify({
		passed: result.passed,
		candidates: result.candidates.map((c) => ({
			repeat: c.repeat,
			passed: c.passed,
			failure: c.failure,
			heldoutCases: c.heldoutCases,
			unitCases: c.unitCases,
			integrationCases: c.integrationCases,
		})),
	}),
);
if (!result.passed) process.exitCode = 1;
