import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { evidenceSource, writeEvidence } from "./evidence";
import { verifyRetainedSkillEvidence } from "./skills-evidence-check";
import { auditTemplateSkillEvidence } from "./template-workflows";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith("--"))
	throw new Error("Usage: bun run phase8:skills <TEMPLATE_RECEIPT>");
const root = await realpath(process.cwd());
const receiptPath = path.relative(root, path.resolve(root, args[0]));
const directory = `artifacts/phase8/skills/${randomUUID()}`;
const startedAt = new Date().toISOString();
const source = await evidenceSource();
const limitations = [
	"Historical independent trials retain their original source and task scope",
	"No fresh agent trials were run for this retained evidence applicability receipt",
	"Deterministic template checks do not establish fresh agent authoring behavior",
	"Changed authoring semantics require review and applicable new independent trials",
];
const artifacts: string[] = [];
const bindings: { originalPath: string; copiedPath: string; sha256: string }[] =
	[];
let stage = "template-and-historical-integrity";
await mkdir(directory, { recursive: true });

async function readBoundedPath(file: string) {
	const resolved = await realpath(path.resolve(root, file));
	const allowed = file.startsWith("artifacts/")
		? path.join(root, "artifacts")
		: root;
	if (!resolved.startsWith(`${allowed}${path.sep}`))
		throw new Error("Evidence input resolved outside its allowed directory");
	return readFile(resolved);
}
async function retain(
	name: string,
	input: { path: string; bytes: Uint8Array; sha256: string },
) {
	const destination = `${directory}/${name}`;
	await writeFile(destination, input.bytes, { flag: "wx" });
	artifacts.push(destination);
	bindings.push({
		originalPath: input.path,
		copiedPath: destination,
		sha256: input.sha256,
	});
}

try {
	const committedReview = await promisify(execFile)(
		"git",
		["show", "HEAD:docs/phase8/template.md"],
		{ encoding: "buffer", maxBuffer: 4 * 1024 * 1024 },
	);
	const verified = await verifyRetainedSkillEvidence(
		{
			receiptPath,
			source,
			audit: await auditTemplateSkillEvidence(root),
			committedReview: committedReview.stdout,
		},
		readBoundedPath,
	);
	stage = "immutable-evidence-copy";
	await retain("template-receipt.json", verified.template);
	for (const [index, artifact] of verified.artifacts.entries())
		await retain(`template-${index}-${path.basename(artifact.path)}`, artifact);
	for (const [index, record] of verified.records.entries())
		await retain(`historical-phase${index + 4}.json`, record);
	await retain("applicability-review.md", verified.review);
	stage = "source-continuity";
	if (!isDeepStrictEqual(await evidenceSource(), source))
		throw new Error(
			"Source changed during retained skill evidence verification",
		);
	const report = `${directory}/report.json`;
	await writeFile(
		report,
		`${JSON.stringify(
			{
				version: 1,
				status: "passed",
				mode: verified.mode,
				freshAgentTrials: verified.freshAgentTrials,
				source,
				templateReceipt: receiptPath,
				templateReport: verified.reportPath,
				skillEvidence: verified.audit,
				bindings,
				limitations,
			},
			null,
			2,
		)}\n`,
		{ flag: "wx" },
	);
	artifacts.push(report);
	stage = "receipt-publication";
	const receipt = await writeEvidence(
		{
			gate: "skills",
			preset: "commercial-local",
			startedAt,
			source,
			outcome: "passed",
			checks: [
				{ name: "Full exact-source template receipt verified", passed: true },
				{
					name: "Retained independent trial record bytes verified",
					passed: true,
				},
				{
					name: "Committed applicability review and current skill audit match",
					passed: true,
				},
				{ name: "Zero fresh agent trials explicitly recorded", passed: true },
			],
			limitations,
		},
		artifacts,
	);
	console.info(`Retained independent skill evidence verified: ${receipt}`);
} catch {
	const report = `${directory}/failure.json`;
	await writeFile(
		report,
		`${JSON.stringify({ version: 1, status: "failed", mode: "retained-independent-evidence-with-explicit-delta-review", failureStage: stage, source, freshAgentTrials: 0, limitations }, null, 2)}\n`,
		{ flag: "wx" },
	);
	artifacts.push(report);
	const receipt = await writeEvidence(
		{
			gate: "skills",
			preset: "commercial-local",
			startedAt,
			source,
			outcome: "failed",
			checks: [
				{ name: "Retained independent evidence verification", passed: false },
			],
			limitations,
		},
		artifacts,
	);
	console.error(`Retained skill evidence verification failed: ${receipt}`);
	process.exitCode = 1;
}
