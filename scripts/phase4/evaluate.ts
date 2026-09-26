import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	adoptEvaluationCandidate,
	prepareEvaluation,
	recordAgentEvidence,
	runEvaluation,
	snapshotEvaluationSource,
	summarizeEvaluation,
} from "./evaluation";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		output: { type: "string" },
		template: { type: "string", default: process.cwd() },
		evaluators: { type: "string" },
		briefs: { type: "string" },
		repeat: { type: "string", default: "2" },
		evidence: { type: "string" },
		tasks: { type: "string" },
		baseline: { type: "string" },
		candidate: { type: "string" },
	},
});
function required(value: string | undefined, option: string) {
	if (!value) throw new Error(`--${option} is required`);
	return resolve(value);
}
async function main() {
	const output = required(values.output, "output");
	const repeat = Number(values.repeat);
	switch (positionals[0]) {
		case "prepare":
			return prepareEvaluation({
				template: required(values.template, "template"),
				output,
				evaluators: required(values.evaluators, "evaluators"),
				briefs: required(values.briefs, "briefs"),
				repeats: repeat,
				baseline: values.baseline,
			});
		case "snapshot":
			return snapshotEvaluationSource(
				required(values.candidate, "candidate"),
				output,
			);
		case "adopt":
			return adoptEvaluationCandidate(
				output,
				repeat,
				required(values.candidate, "candidate"),
			);
		case "record":
			return recordAgentEvidence(
				output,
				repeat,
				JSON.parse(
					await readFile(required(values.evidence, "evidence"), "utf8"),
				),
			);
		case "run": {
			const run = await runEvaluation(output, repeat, values.tasks?.split(","));
			if (
				[
					...Object.values(run.checks).flat(),
					...(run.applicationChecks ?? []),
				].some((check) => !check.passed)
			)
				process.exitCode = 1;
			return run;
		}
		case "summary": {
			const summary = await summarizeEvaluation(output);
			if (!summary.accepted) process.exitCode = 1;
			return summary;
		}
		default:
			throw new Error(
				"Use snapshot, prepare, adopt, record, run, or summary; see docs/phase4/evaluation.md",
			);
	}
}
main()
	.then((result) => console.log(JSON.stringify(result, null, 2)))
	.catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
