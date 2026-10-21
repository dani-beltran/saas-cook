import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2]);
const load = async (file) =>
	JSON.parse(await readFile(path.join(output, file), "utf8"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const summary = await load("summary.json"),
	manifest = await load("manifest.json"),
	customization = await load("customization-preservation.json"),
	transcriptAudit = await load("transcript-audit.json"),
	censusManifest = await load("regression-census/manifest.json");
assert.equal(
	summary.passed,
	true,
	"Both complete candidate checks/repeats required",
);
assert.equal(customization.passed, true);
assert.equal(transcriptAudit.passed, true);
for (const [file, hash] of Object.entries(censusManifest.hashes))
	assert.equal(
		digest(await readFile(path.join(output, "regression-census", file))),
		hash,
		`Supplementary control changed: ${file}`,
	);
const result = {
	version: 1,
	phase: 6,
	status: "passed",
	checkedAt: new Date().toISOString(),
	templateCommit: manifest.templateCommit,
	initialDispatchSourceSha256: manifest.initialDispatchSourceSha256,
	protectedSourceSha256: manifest.sourceSha256,
	initialProtectedSourceFiles: Object.keys(manifest.sourceHashes).length,
	controls: {
		version: manifest.controlVersion,
		hashes: manifest.controlHashes,
		controllerVersion: manifest.controllerVersion,
		controllerHashes: manifest.controllerHashes,
		originalCaseCensus: censusManifest,
	},
	configuration: summary.configuration,
	candidates: [],
	scope:
		"Five declared Phase6 Commercial authoring/verification tasks in two independent candidates; no candidate promoted; separate live provider and root release gates remain necessary.",
	exceptions: [
		"Original report-parser application dependency added after dispatch, preserving all prior source hashes.",
		"Evaluator seeded existing localized support behavior at planned partial stop before resumed evolution.",
		"Evaluator-only unsafe seed line wrapping corrected after author source-check failures; original bytes/diff/hashes retained. No unsafe behavior changed.",
		"Candidate2 optional generated-declaration reporter failure retained separately; seven successful application commands reused only after unchanged source/control/log/report revalidation. No behavior assertion relaxed.",
	],
};
for (const candidate of summary.candidates) {
	const repeat = candidate.repeat,
		folder = `run-${repeat}`;
	const census = await load(`regression-census/run-${repeat}.json`);
	assert.equal(census.passed, true);
	assert.equal(
		census.baselineSha256,
		censusManifest.hashes["baseline-cases.json"],
	);
	assert.equal(census.candidateFinalSourceSha256, candidate.finalSourceSha256);
	const customized = customization.results.find((c) => c.repeat === repeat);
	assert.equal(customized?.sourceBytesPreserved, true);
	assert.ok(
		transcriptAudit.candidates.some(
			(c) => c.repeat === repeat && c.sameSessionResumeAndRepeat,
		),
	);
	const before = await load(`${folder}/checkpoint-verified.json`),
		after = await load(`${folder}/checkpoint-after-repeat.json`),
		cleanup = await load(`${folder}/checkpoint-cleanup.json`);
	assert.equal(before.passed, true);
	assert.equal(after.passed, true);
	assert.equal(cleanup.passed, true);
	assert.equal(before.projectId, after.projectId);
	assert.equal(before.migrationCount, after.migrationCount);
	const transcripts = {};
	for (const name of [
		"author-resume.jsonl",
		"author-repair.jsonl",
		"author-repeat.jsonl",
	]) {
		const bytes = await readFile(path.join(output, folder, name));
		const events = bytes
			.toString()
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.ok(events.some((event) => event.type === "turn.completed"));
		assert.ok(
			!events.some((event) => ["error", "turn.failed"].includes(event.type)),
			`Unresolved agent failure in ${folder}/${name}`,
		);
		transcripts[name] = digest(bytes);
	}
	const failures = (await readdir(path.join(output, folder))).filter(
		(name) =>
			name.includes("attempt-1") ||
			name === "author-initial.jsonl" ||
			(name === "author-initial-attempt-2.jsonl" && repeat === 1),
	);
	result.candidates.push({
		...candidate,
		originalCases: census.caseCounts,
		preservation: {
			realProjectBeforeAndAfterRepeat: true,
			migrationRows: before.migrationCount,
			sourceIdentical: true,
			localizedCodeCustomization: true,
			customizationFragmentSha256: customized.fragmentSha256,
			allOriginalProtectedHashesPreserved: true,
			seedFormattingExceptionRecorded: true,
			checkpointCleanupPassed: true,
		},
		transcripts,
		retainedSetupOrDispatchAttempts: failures,
	});
}
await writeFile(
	path.join(output, "release-result.json"),
	`${JSON.stringify(result, null, 2)}\n`,
);
console.log(
	JSON.stringify({
		status: result.status,
		candidates: result.candidates.map((c) => ({
			repeat: c.repeat,
			heldout: c.heldoutCases,
			unit: c.unitCases,
			integration: c.integrationCases,
			sourceIdentical: c.sourceIdenticalRepeat,
		})),
	}),
);
