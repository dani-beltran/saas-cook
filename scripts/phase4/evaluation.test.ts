import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
	readFreshReport,
	verifyPlaywrightReport,
	verifyVitestReport,
} from "../../evaluations/phase4/heldout/reports.ts";
import {
	adoptEvaluationCandidate,
	assertEvaluationIntegrity,
	prepareEvaluation,
	recordAgentEvidence,
	runEvaluation,
	snapshotEvaluationSource,
	summarizeEvaluation,
	verifyCaseReport,
} from "./evaluation";

const exec = promisify(execFile);
const roots: string[] = [];
const ids = Array.from(
	{ length: 10 },
	(_, index) => `task-${String(index + 1).padStart(2, "0")}`,
);
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "phase4-harness-test-"));
	roots.push(root);
	const template = join(root, "template");
	const evaluators = join(root, "evaluators");
	const briefs = join(root, "briefs");
	const output = join(root, "evaluation");
	for (const path of [
		template,
		evaluators,
		briefs,
		join(template, ".agents/skills/example"),
		join(template, "evaluations/hidden"),
		join(template, "node_modules"),
	])
		await mkdir(path, { recursive: true });
	await writeFile(
		join(template, ".agents/skills/example/SKILL.md"),
		"name: infrastructure test only\n",
	);
	await writeFile(join(template, "app.ts"), "export const value = 1;\n");
	await writeFile(join(template, ".env"), "SECRET=must-not-copy\n");
	await writeFile(
		join(template, "credentials.json"),
		'{"key":"must-not-copy"}',
	);
	await writeFile(
		join(template, "evaluations/hidden/answers.ts"),
		"held-out expectations",
	);
	await writeFile(join(template, "node_modules/dependency.js"), "dependency");
	await exec("git", ["init", "-q"], { cwd: template });
	await exec("git", ["add", "."], { cwd: template });
	await exec(
		"git",
		[
			"-c",
			"user.name=Harness Test",
			"-c",
			"user.email=harness@example.invalid",
			"commit",
			"-qm",
			"test: fixture",
		],
		{ cwd: template },
	);
	await writeFile(
		join(evaluators, "check.mjs"),
		`import { existsSync } from 'node:fs';
const taskId = process.argv[2];
const failed = existsSync('fail-case');
console.log('PHASE4_RESULT=' + JSON.stringify({taskId,checkId:'behavior',cases:[{id:'required',status:failed?'failed':'passed'}]}));\n`,
	);
	await writeFile(
		join(evaluators, "manifest.json"),
		JSON.stringify({
			version: 1,
			tasks: ids.map((id) => ({
				id,
				brief: `${id}.md`,
				checks: [
					{
						id: "behavior",
						argv: [process.execPath, "{evaluators}/check.mjs", id],
						caseIds: ["required"],
					},
				],
			})),
			applicationChecks: [
				{
					id: "source",
					argv: [
						process.execPath,
						"-e",
						"console.log('APPLICATION_CHECK_PASSED')",
					],
					successPattern: "^APPLICATION_CHECK_PASSED$",
				},
			],
		}),
	);
	for (const id of ids)
		await writeFile(
			join(briefs, `${id}.md`),
			`${id}: harness infrastructure fixture, not an AI behavior evaluation.\n`,
		);
	await prepareEvaluation({ template, output, evaluators, briefs, repeats: 2 });
	const transcriptPath = join(root, "transcript.md");
	await writeFile(
		transcriptPath,
		"This is explicitly synthetic unit-test input for evidence bookkeeping. It does not represent an actual AI agent run and cannot be used as release evidence.\n",
	);
	const evidence = {
		kind: "ai-agent",
		provider: "unit-test fixture only",
		model: "test-fixture-not-real-ai",
		configuration: { testOnly: true },
		taskIds: ids,
		transcriptPath,
	};
	return { root, template, output, evidence };
}

describe("evaluation infrastructure (does not establish actual AI behavior)", () => {
	it("copies source and skill guidance without credentials, Git, dependencies or held-out answers", async () => {
		const { output } = await fixture();
		const manifest = await assertEvaluationIntegrity(output);
		expect(Object.keys(manifest.templateSourceHashes)).toEqual([
			".agents/skills/example/SKILL.md",
			"app.ts",
		]);
		expect(manifest.repeats).toBe(2);
		expect(Object.keys(manifest.requirements)).toEqual(ids);
		expect((await summarizeEvaluation(output)).accepted).toBe(false);
		await expect(runEvaluation(output, 1)).rejects.toThrow(
			"Actual AI agent evidence",
		);
	});
	it("rejects malformed, deterministic-only and empty agent evidence", async () => {
		const { output, evidence } = await fixture();
		await expect(
			recordAgentEvidence(output, 1, {
				...evidence,
				kind: "deterministic-tests",
			}),
		).rejects.toThrow();
		await expect(
			recordAgentEvidence(output, 1, { ...evidence, configuration: {} }),
		).rejects.toThrow();
		await writeFile(evidence.transcriptPath, "done");
		await expect(recordAgentEvidence(output, 1, evidence)).rejects.toThrow(
			"substantive transcript",
		);
	});
	it("rejects missing, skipped, failed, duplicated and foreign behavioral cases even at exit zero", () => {
		const check = { id: "behavior", caseIds: ["required"] };
		expect(() => verifyCaseReport("", "task-01", check)).toThrow();
		for (const cases of [
			[],
			[{ id: "required", status: "skipped" }],
			[{ id: "required", status: "failed" }],
			[{ id: "other", status: "passed" }],
			[
				{ id: "required", status: "passed" },
				{ id: "required", status: "passed" },
			],
		]) {
			expect(() =>
				verifyCaseReport(
					`PHASE4_RESULT=${JSON.stringify({ taskId: "task-01", checkId: "behavior", cases })}`,
					"task-01",
					check,
				),
			).toThrow();
		}
	});
	it("rejects held-out expectation tampering", async () => {
		const { output } = await fixture();
		await writeFile(
			join(output, "control/evaluators/check.mjs"),
			"console.log('forged pass')",
		);
		await expect(assertEvaluationIntegrity(output)).rejects.toThrow(
			"integrity",
		);
	});
	it("requires every task in every declared repeat and retains failed repeat evidence", async () => {
		const { output, evidence } = await fixture();
		await recordAgentEvidence(output, 1, evidence);
		await runEvaluation(output, 1);
		expect((await summarizeEvaluation(output)).failures).toContain(
			"run-2: actual AI run evidence missing",
		);
		await recordAgentEvidence(output, 2, evidence);
		await writeFile(
			join(output, "run-2/candidate/fail-case"),
			"seeded infrastructure failure",
		);
		const failedRun = await runEvaluation(output, 2);
		const summary = await summarizeEvaluation(output);
		expect(summary.accepted).toBe(false);
		expect(summary.failures).toContain(
			"run-2/task-01: missing or failed required behavior",
		);
		expect(
			await readFile(
				join(output, "run-2", failedRun.checks["task-01"][0].log),
				"utf8",
			),
		).toContain('"status":"failed"');
		await rm(join(output, "run-2/candidate/fail-case"));
		await runEvaluation(output, 2);
		expect(
			await readFile(
				join(output, "run-2", failedRun.checks["task-01"][0].log),
				"utf8",
			),
		).toContain('"status":"failed"');
	});
	it("detects changed source and transcript/log tampering after passing bookkeeping fixtures", async () => {
		const { output, evidence } = await fixture();
		for (const repeat of [1, 2]) {
			await recordAgentEvidence(output, repeat, evidence);
			await runEvaluation(output, repeat);
		}
		expect((await summarizeEvaluation(output)).accepted).toBe(true);
		await writeFile(
			join(output, "run-1/candidate/app.ts"),
			"changed after checks",
		);
		await writeFile(join(output, "run-1/agent-transcript.md"), "tampered");
		const run = JSON.parse(
			await readFile(join(output, "run-1/result.json"), "utf8"),
		);
		await writeFile(
			join(output, "run-1", run.checks["task-01"][0].log),
			"tampered",
		);
		const summary = await summarizeEvaluation(output);
		expect(summary.accepted).toBe(false);
		expect(summary.failures).toEqual(
			expect.arrayContaining([
				"run-1: unverified or changed source",
				"run-1: transcript integrity failed",
				"run-1: command log integrity failed",
			]),
		);
	});
	it("adopts independently dispatched source against a preserved baseline without credentials", async () => {
		const { root, output, evidence } = await fixture();
		const external = join(root, "external");
		await snapshotEvaluationSource(join(output, "run-1/candidate"), external);
		await writeFile(join(external, "app.ts"), "custom agent edit\n");
		await writeFile(join(external, ".env"), "DO_NOT_COPY=yes\n");
		await adoptEvaluationCandidate(output, 1, external);
		await recordAgentEvidence(output, 1, evidence);
		await runEvaluation(output, 1, ["task-01"]);
		const diff = await readFile(join(output, "run-1/source.diff"), "utf8");
		expect(diff).toContain("custom agent edit");
		expect(diff).not.toContain("DO_NOT_COPY");
		expect((await summarizeEvaluation(output)).accepted).toBe(false);
		const replacement = join(root, "replacement");
		await mkdir(replacement);
		await writeFile(join(replacement, "app.ts"), "replacement run\n");
		await adoptEvaluationCandidate(output, 1, replacement);
		expect(await readFile(join(external, "app.ts"), "utf8")).toBe(
			"custom agent edit\n",
		);
		expect(
			await readFile(join(external, ".agents/skills/example/SKILL.md"), "utf8"),
		).toContain("infrastructure test only");
	});
});

describe("Phase 4 reused-suite report enforcement", () => {
	const required = [{ file: "feature.test.ts", name: "required behavior" }];
	const vitestReport = () => ({
		success: true,
		numFailedTestSuites: 0,
		numFailedTests: 0,
		numPendingTestSuites: 0,
		numPendingTests: 0,
		numTodoTests: 0,
		numTotalTests: 1,
		testResults: [
			{
				name: "/candidate/feature.test.ts",
				assertionResults: [{ fullName: "required behavior", status: "passed" }],
			},
		],
	});
	it("rejects removed, renamed, skipped and missing parameterized baseline cases despite a successful suite", () => {
		expect(
			verifyVitestReport(vitestReport(), "/candidate", required),
		).toHaveLength(1);
		for (const status of ["skipped", "pending", "todo", "failed"]) {
			const report = vitestReport();
			report.testResults[0].assertionResults[0].status = status;
			expect(() =>
				verifyVitestReport(report, "/candidate", required),
			).toThrow();
		}
		const missing = vitestReport();
		missing.testResults[0].assertionResults[0].fullName =
			"unrelated passing case";
		expect(() => verifyVitestReport(missing, "/candidate", required)).toThrow(
			"Required case missing",
		);
		expect(() =>
			verifyVitestReport(vitestReport(), "/candidate", [
				...required,
				...required,
			]),
		).toThrow("Required case missing");
		const added = vitestReport();
		added.numTotalTests++;
		added.testResults[0].assertionResults.push({
			fullName: "new behavior",
			status: "passed",
		});
		expect(verifyVitestReport(added, "/candidate", required)).toHaveLength(2);
	});
	it("permits only deliberate unselected held-out cases and requires every selected identity", () => {
		const report = vitestReport();
		report.numTotalTests++;
		report.numPendingTests++;
		report.testResults[0].assertionResults.push({
			fullName: "other task",
			status: "skipped",
		});
		expect(() => verifyVitestReport(report, "/candidate", required)).toThrow(
			"Skipped Vitest case",
		);
		expect(
			verifyVitestReport(report, "/candidate", required, "required "),
		).toHaveLength(1);
		report.testResults[0].assertionResults[0].status = "skipped";
		expect(() =>
			verifyVitestReport(report, "/candidate", required, "required "),
		).toThrow();
	});
	it("rejects missing and stale reports instead of reusing prior success", async () => {
		const root = await mkdtemp(join(tmpdir(), "phase4-report-test-"));
		roots.push(root);
		const file = join(root, "report.json");
		await expect(readFreshReport(file, Date.now())).rejects.toThrow();
		await writeFile(file, JSON.stringify(vitestReport()));
		await utimes(file, new Date(0), new Date(0));
		await expect(readFreshReport(file, Date.now())).rejects.toThrow(
			"Stale structured report",
		);
	});
	it("rejects skipped, expected-failing, retried and missing browser baseline cases", () => {
		const report = {
			config: { rootDir: "/candidate" },
			errors: [],
			stats: { unexpected: 0, skipped: 0, flaky: 0 },
			suites: [
				{
					title: "feature.test.ts",
					specs: [
						{
							title: "required behavior",
							file: "feature.test.ts",
							ok: true,
							tests: [
								{
									expectedStatus: "passed",
									status: "expected",
									results: [{ status: "passed", errors: [] }],
								},
							],
						},
					],
				},
			],
		};
		expect(verifyPlaywrightReport(report, "/candidate", required)).toHaveLength(
			1,
		);
		for (const change of [
			"skipped",
			"expected-failure",
			"retry",
			"missing",
		] as const) {
			const altered = structuredClone(report);
			const test = altered.suites[0].specs[0].tests[0];
			if (change === "skipped") test.results[0].status = "skipped";
			if (change === "expected-failure") test.expectedStatus = "failed";
			if (change === "retry")
				test.results.push({ status: "passed", errors: [] });
			if (change === "missing")
				altered.suites[0].specs[0].title = "unrelated case";
			expect(() =>
				verifyPlaywrightReport(altered, "/candidate", required),
			).toThrow();
		}
	});
});
