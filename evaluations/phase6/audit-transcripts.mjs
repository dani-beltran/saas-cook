import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2]);
const load = async (file) =>
	JSON.parse(await readFile(path.join(output, file), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const configuration = await load("agent-configuration.json"),
	manifest = await load("manifest.json");
assert.equal(configuration.length, 2);
assert.equal(new Set(configuration.map((c) => c.sessionId)).size, 2);
const result = {
	version: 1,
	checkedAt: new Date().toISOString(),
	passed: true,
	readIsolation:
		"Candidate workspace sandbox plus instructions, externally held controls and transcript audit; directory separation does not provide OS read isolation.",
	candidates: [],
};
for (const candidate of configuration) {
	const folder = `run-${candidate.repeat}`;
	const turns = [],
		completedCommands = [];
	for (const file of [
		candidate.initialTranscript,
		`${folder}/author-resume.jsonl`,
		`${folder}/author-repair.jsonl`,
		`${folder}/author-repeat.jsonl`,
	]) {
		const bytes = await readFile(path.join(output, file));
		const events = bytes
			.toString()
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.equal(
			events.find((e) => e.type === "thread.started")?.thread_id,
			candidate.sessionId,
			`Wrong independent/resumed session: ${file}`,
		);
		assert.ok(events.some((e) => e.type === "turn.completed"));
		assert.ok(!events.some((e) => ["error", "turn.failed"].includes(e.type)));
		const commands = events
			.filter(
				(e) =>
					e.type === "item.completed" &&
					e.item?.type === "command_execution" &&
					e.item.status === "completed",
			)
			.map((e) => e.item);
		completedCommands.push(...commands);
		const expectedSkills =
			file === candidate.initialTranscript
				? ["saas-add-feature", "saas-add-dashboard-page", "saas-verify-feature"]
				: file.endsWith("author-resume.jsonl")
					? ["saas-evolve-feature", "saas-verify-feature"]
					: [];
		const reads = {};
		for (const name of expectedSkills) {
			const skill = `.agents/skills/${name}/SKILL.md`;
			const command = commands.find(
				(c) => c.exit_code === 0 && c.command.includes(skill),
			);
			assert.ok(
				command,
				`Missing successful candidate-local skill read: ${file}/${skill}`,
			);
			reads[skill] = manifest.sourceHashes[skill];
			assert.ok(reads[skill]);
		}
		turns.push({
			file,
			sha256: digest(bytes),
			sessionId: candidate.sessionId,
			completedCommands: commands.length,
			requiredSkillReads: reads,
		});
	}
	for (const command of completedCommands) {
		for (const protectedDirectory of [
			"controls",
			"controller",
			"regression-census",
		]) {
			assert.ok(
				!command.command.includes(path.join(output, protectedDirectory)),
				`Observed evaluator-path access in candidate ${candidate.repeat}`,
			);
		}
	}
	const attempts = [];
	for (const name of (await readdir(path.join(output, folder))).filter(
		(n) => n.startsWith("author") && n.endsWith(".jsonl"),
	)) {
		const bytes = await readFile(path.join(output, folder, name));
		const events = bytes
			.toString()
			.trim()
			.split("\n")
			.filter(Boolean)
			.map(JSON.parse);
		attempts.push({
			file: `${folder}/${name}`,
			sha256: digest(bytes),
			completed: events.some((e) => e.type === "turn.completed"),
			failed: events.some((e) => ["error", "turn.failed"].includes(e.type)),
			empty: bytes.length === 0,
		});
	}
	result.candidates.push({
		repeat: candidate.repeat,
		independentSession: candidate.sessionId,
		sameSessionResumeAndRepeat: true,
		turns,
		retainedAttempts: attempts,
		observedDirectEvaluatorPathAccess: false,
	});
}
await writeFile(
	path.join(output, "transcript-audit.json"),
	`${JSON.stringify(result, null, 2)}\n`,
);
console.log(
	JSON.stringify({
		passed: result.passed,
		candidates: result.candidates.length,
	}),
);
