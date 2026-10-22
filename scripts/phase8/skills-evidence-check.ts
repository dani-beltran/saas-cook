import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { evidenceSchema } from "./evidence";
import type { auditTemplateSkillEvidence } from "./template-workflows";

const retainedRecords = [
	"docs/phase4/evidence/release.json",
	"docs/phase5/evaluation-2026-10-19.json",
	"docs/phase6/evidence/acceptance-2026-10-21.json",
] as const;
const reviewPath = "docs/phase8/template.md";
const mode = "retained-independent-evidence-with-explicit-delta-review";
const artifactPath = z
	.string()
	.regex(/^artifacts\/[a-zA-Z0-9._/-]+$/)
	.refine(
		(value) => !value.split("/").some((part) => ["", ".", ".."].includes(part)),
	);
const hash = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
type SkillAudit = Awaited<ReturnType<typeof auditTemplateSkillEvidence>>;
type Source = z.output<typeof evidenceSchema>["source"];
const reportSchema = z.object({
	mode: z.literal("full"),
	source: evidenceSchema.shape.source,
	skillEvidence: z.unknown(),
	checks: evidenceSchema.shape.checks,
	commands: z.array(
		z.object({
			name: z.string(),
			argv: z.array(z.string()),
			cwd: z.string(),
			exitCode: z.number().nullable(),
			log: artifactPath,
		}),
	),
});

/**
 * Verify retained independent trials against a full template check of the current clean source.
 * @param input Receipt path under artifacts, current source/audit and committed review bytes.
 * The caller obtains the audit from auditTemplateSkillEvidence and the review from Git HEAD.
 * @param read Read-only byte loader; tests may supply an isolated in-memory filesystem.
 * @returns Verified bytes and hashes for immutable copying, plus the original template receipt.
 * No image or new agent trial is required. Throws on missing, stale, dirty, changed or partial
 * evidence. Historical trials retain their original source/task scope; this proves applicability
 * and integrity only, never fresh authoring behavior on the current source.
 */
export async function verifyRetainedSkillEvidence(
	input: {
		receiptPath: string;
		source: Source;
		audit: SkillAudit;
		committedReview: Uint8Array;
	},
	read: (file: string) => Promise<Uint8Array> = readFile,
) {
	const source = evidenceSchema.shape.source.parse(input.source);
	if (source.dirty)
		throw new Error("Skills evidence requires clean current source");
	const receiptPath = artifactPath.parse(input.receiptPath);
	const receiptBytes = await read(receiptPath);
	const receipt = evidenceSchema.parse(
		JSON.parse(Buffer.from(receiptBytes).toString("utf8")),
	);
	if (
		receipt.gate !== "template" ||
		receipt.preset !== "commercial-local" ||
		receipt.outcome !== "passed" ||
		!isDeepStrictEqual(receipt.source, source)
	)
		throw new Error(
			"A passed full template receipt for the exact clean source is required",
		);
	if (
		!receipt.artifacts.length ||
		new Set(receipt.artifacts.map((artifact) => artifact.path)).size !==
			receipt.artifacts.length
	)
		throw new Error("Template artifacts must be present and unambiguous");
	const artifacts = [];
	for (const artifact of receipt.artifacts) {
		artifactPath.parse(artifact.path);
		const bytes = await read(artifact.path);
		if (hash(bytes) !== artifact.sha256)
			throw new Error("Template artifact digest mismatch");
		artifacts.push({ ...artifact, bytes });
	}
	const reports = artifacts.filter(({ path }) => path.endsWith("/report.json"));
	if (reports.length !== 1)
		throw new Error("Exactly one attached template report is required");
	const report = reportSchema.parse(
		JSON.parse(Buffer.from(reports[0].bytes).toString("utf8")),
	);
	if (
		!isDeepStrictEqual(report.source, source) ||
		!isDeepStrictEqual(report.checks, receipt.checks)
	)
		throw new Error(
			"Template report source or checks do not match the receipt",
		);
	for (const name of [
		"retained-agent-evidence-applicability",
		"skill-contracts-and-real-service-setup",
		"source-unchanged-during-verification",
	])
		if (!report.checks.some((check) => check.name === name && check.passed))
			throw new Error("Full template skill and source checks are required");
	const commands = report.commands.filter(
		({ name }) => name === "skills-check",
	);
	if (
		commands.length !== 1 ||
		commands[0].cwd !== "source" ||
		commands[0].exitCode !== 0 ||
		!isDeepStrictEqual(commands[0].argv, ["bun", "run", "skills:check"]) ||
		!artifacts.some(({ path }) => path === commands[0].log)
	)
		throw new Error(
			"Full template must retain the successful current skills check log",
		);
	if (
		input.audit.mode !== mode ||
		input.audit.freshAgentTrials !== 0 ||
		input.audit.review !== reviewPath ||
		!isDeepStrictEqual(report.skillEvidence, input.audit) ||
		!isDeepStrictEqual(
			Object.keys(input.audit.evidenceRecords).sort(),
			[...retainedRecords].sort(),
		)
	)
		throw new Error(
			"Template skill audit no longer matches current applicability",
		);
	const records = [];
	for (const path of retainedRecords) {
		const bytes = await read(path);
		const sha256 = hash(bytes);
		if (sha256 !== input.audit.evidenceRecords[path])
			throw new Error(
				"Historical skill evidence changed after the applicability audit",
			);
		records.push({ path, bytes, sha256 });
	}
	const reviewBytes = await read(reviewPath);
	if (hash(reviewBytes) !== hash(input.committedReview))
		throw new Error("Applicability review must match its committed bytes");
	return {
		mode,
		freshAgentTrials: 0,
		audit: input.audit,
		receipt,
		template: {
			path: receiptPath,
			bytes: receiptBytes,
			sha256: hash(receiptBytes),
		},
		artifacts,
		reportPath: reports[0].path,
		records,
		review: { path: reviewPath, bytes: reviewBytes, sha256: hash(reviewBytes) },
	};
}
