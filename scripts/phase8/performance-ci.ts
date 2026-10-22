import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { evidenceSchema, writeEvidence } from "./evidence";
import type { performanceGates } from "./performance-metrics";

/** Select exactly one declared workload mode; unknown, combined or repeated options throw. */
export function performanceMode(args: readonly string[]) {
	if (args.length === 0) return "full";
	if (args.length === 1 && args[0] === "--smoke") return "smoke";
	if (args.length === 1 && args[0] === "--ci-smoke") return "ci-smoke";
	throw new Error("Usage: phase8:performance [--smoke | --ci-smoke]");
}

const referenceChecks = [
	"completed",
	"sustainedProfile",
	"availability",
	"readLatency",
	"writeLatency",
	"fenceWait",
	"createToReadable",
	"sourceReadiness",
	"authorization",
	"sourceStable",
	"sparseAuthorization",
	"hotDistribution",
	"canonicalMix",
	"tenantFairness",
	"commercialContention",
	"usageVisibility",
] as const satisfies readonly (keyof ReturnType<typeof performanceGates>)[];
const expectedChecks = [
	...referenceChecks,
	"cleanSource",
	"dependencyHealth",
	"environmentCleanup",
	"cleanup",
];
const diagnosticChecks = new Set<string>(["readLatency", "writeLatency"]);
const observedLatency = z.object({
	count: z.number().int().positive(),
	p95: z.number().finite().nonnegative(),
	p99: z.number().finite().nonnegative(),
	max: z.number().finite().nonnegative(),
});
const measuredSmoke = z.object({
	status: z.enum(["passed", "failed"]),
	acceptanceEligible: z.literal(false),
	durationSeconds: z.number().finite().min(30),
	warmupMs: z.literal(2000),
	clients: z.literal(50),
	tenants: z.literal(100),
	memberships: z.literal(1000),
	projects: z.literal(100000),
	workloadVersion: z.literal("direct-project-http-commercial-v1"),
	latencyMs: z.object({ read: observedLatency, write: observedLatency }),
});

/**
 * Assess the separately scoped CI smoke without changing any reference performance result.
 * @param run Final strict-smoke receipt facts, after cleanup. Missing/unknown checks fail closed.
 * @returns CI correctness status plus the unchanged reference target failures. Only read/write
 * latency may be diagnostic; fence/readiness/usage budgets and every correctness gate still bind.
 * This result is always ineligible for sustained performance or release acceptance.
 */
export function ciCorrectnessOutcome(run: {
	gate: string;
	status: string;
	checks: Record<string, boolean>;
	dirty: boolean;
	imagePresent: boolean;
	measuredWorkload: boolean;
}) {
	const keys = Object.keys(run.checks);
	const exactCheckContract =
		keys.length === expectedChecks.length &&
		expectedChecks.every((name) => typeof run.checks[name] === "boolean");
	const strictPassed =
		exactCheckContract && Object.values(run.checks).every(Boolean);
	const checks = {
		strictSmoke: run.gate === "performance-smoke",
		exactCheckContract,
		strictOutcomeConsistent:
			run.status === (strictPassed ? "passed" : "failed"),
		cleanCheckout: !run.dirty,
		imageIdentity: run.imagePresent,
		measuredWorkload: run.measuredWorkload,
		...Object.fromEntries(
			expectedChecks
				.filter((name) => !diagnosticChecks.has(name))
				.map((name) => [name, run.checks[name] === true]),
		),
	};
	return {
		status: Object.values(checks).every(Boolean)
			? ("passed" as const)
			: ("failed" as const),
		acceptanceEligible: false as const,
		checks,
		referenceTargetFailures: expectedChecks.filter(
			(name) => run.checks[name] === false,
		),
	};
}

/**
 * Retain a distinct CI receipt alongside the actual strict performance-smoke receipt.
 * @param strictReceiptPath Just-written immutable strict receipt; its gate/artifact hashes are verified.
 * @param reportPath Unique ignored artifacts/phase8 path for this attempt's CI interpretation.
 * @param measurementReportPath Exact workload report included once in that strict receipt; other
 * artifacts retain the isolated service/storage provenance and cleanup observations.
 * @returns CI outcome and receipt path. Any malformed/tampered artifact or write failure throws;
 * strict failures are never rewritten and both receipts hash the same underlying measurements.
 */
export async function writeCiCorrectnessEvidence(
	strictReceiptPath: string,
	reportPath: string,
	measurementReportPath: string,
) {
	if (
		!/^artifacts\/phase8\/[a-zA-Z0-9._/-]+\.json$/.test(reportPath) ||
		reportPath.split("/").includes("..")
	)
		throw new Error("Invalid CI smoke report path");
	const strictBytes = await readFile(strictReceiptPath);
	const strict = evidenceSchema.parse(JSON.parse(strictBytes.toString("utf8")));
	if (
		strict.gate !== "performance-smoke" ||
		strict.preset !== "commercial-local" ||
		strict.artifacts.filter(({ path }) => path === measurementReportPath)
			.length !== 1
	)
		throw new Error("CI correctness requires an actual strict smoke receipt");
	for (const artifact of strict.artifacts) {
		if (
			artifact.path.split("/").includes("..") ||
			createHash("sha256")
				.update(await readFile(artifact.path))
				.digest("hex") !== artifact.sha256
		)
			throw new Error("Strict smoke artifact digest mismatch");
	}
	const measurements = measuredSmoke.safeParse(
		JSON.parse(await readFile(measurementReportPath, "utf8")),
	);
	const strictChecks = Object.fromEntries(
		strict.checks.map(({ name, passed }) => [name, passed]),
	);
	const measuredWorkload =
		measurements.success &&
		measurements.data.status === strict.outcome &&
		strictChecks.readLatency === measurements.data.latencyMs.read.p95 < 500 &&
		strictChecks.writeLatency === measurements.data.latencyMs.write.p95 < 800;
	const failedCrudTargets = measurements.success
		? [
				{
					check: "readLatency",
					p95Ms: measurements.data.latencyMs.read.p95,
					targetExclusiveMs: 500,
				},
				{
					check: "writeLatency",
					p95Ms: measurements.data.latencyMs.write.p95,
					targetExclusiveMs: 800,
				},
			].filter(({ check }) => strictChecks[check] === false)
		: [];
	const outcome = ciCorrectnessOutcome({
		gate: strict.gate,
		status: strict.outcome,
		checks: strictChecks,
		dirty: strict.source.dirty,
		imagePresent: Boolean(strict.image),
		measuredWorkload,
	});
	const report = {
		gate: "performance-ci-correctness",
		...outcome,
		strictPerformanceOutcome: strict.outcome,
		strictReceipt: {
			path: strictReceiptPath,
			sha256: createHash("sha256").update(strictBytes).digest("hex"),
		},
		strictArtifacts: strict.artifacts,
		diagnosticOnlyChecks: [...diagnosticChecks],
		failedCrudTargets,
	};
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
		flag: "wx",
	});
	const receiptPath = await writeEvidence(
		{
			gate: "performance-ci-correctness",
			preset: strict.preset,
			startedAt: strict.startedAt,
			source: strict.source,
			...(strict.image ? { image: strict.image } : {}),
			outcome: outcome.status,
			checks: Object.entries(outcome.checks).map(([name, passed]) => ({
				name,
				passed,
			})),
			limitations: [
				"CI correctness only - cannot satisfy performance-full or release acceptance",
				"Read and write latency targets remain strict in the linked performance-smoke receipt",
				"All other reference gates remain enforced including fence readiness usage fairness and cleanup",
			],
		},
		[
			reportPath,
			strictReceiptPath,
			...strict.artifacts.map(({ path }) => path),
		],
	);
	if (strict.outcome === "failed")
		console.warn(
			JSON.stringify({
				warning:
					"Strict performance smoke FAILED; CI correctness does not accept performance",
				ciCorrectness: outcome.status,
				failedCrudTargets,
				strictReceiptPath,
			}),
		);
	console.log(
		JSON.stringify({
			event: "benchmark.ci_correctness",
			...report,
			receiptPath,
		}),
	);
	return { ...outcome, receiptPath };
}
