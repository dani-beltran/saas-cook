import { z } from "zod";

type Statistics = {
	count: number;
	p95: number | null;
	p99: number | null;
	max: number | null;
};
/** Summarizes observed milliseconds; empty measurements remain null and cannot pass a gate. */
export function latencyStatistics(values: readonly number[]): Statistics {
	if (values.some((value) => !Number.isFinite(value) || value < 0))
		throw new Error("Invalid latency observation");
	const ordered = [...values].sort((a, b) => a - b);
	const percentile = (p: number) =>
		ordered[Math.ceil(ordered.length * p) - 1] ?? null;
	return {
		count: ordered.length,
		p95: percentile(0.95),
		p99: percentile(0.99),
		max: ordered.at(-1) ?? null,
	};
}

/** Reduces the observer's bounded integer histogram without allocating one entry per request.
 * Values are conservative millisecond bucket upper bounds; rawMax preserves the actual maximum.
 * Invalid or negative histogram values throw so missing/corrupt telemetry cannot establish acceptance.
 */
export function histogramStatistics(
	histogram: Record<string, number>,
	rawMax?: number,
): Statistics {
	const ordered = Object.entries(histogram)
		.map(([value, count]) => [Number(value), count])
		.sort((a, b) => a[0] - b[0]);
	if (
		ordered.some(
			([value, count]) =>
				!Number.isFinite(value) ||
				value < 0 ||
				!Number.isInteger(count) ||
				count < 1,
		)
	)
		throw new Error("Invalid performance histogram");
	const count = ordered.reduce((n, [, count]) => n + count, 0);
	const percentile = (p: number) => {
		let n = 0;
		for (const [value, frequency] of ordered) {
			n += frequency;
			if (n >= Math.ceil(count * p)) return value;
		}
		return null;
	};
	return {
		count,
		p95: percentile(0.95),
		p99: percentile(0.99),
		max: count ? (rawMax ?? ordered.at(-1)?.[0] ?? null) : null,
	};
}

const thresholdCount = z
	.number()
	.int()
	.nonnegative()
	.max(Number.MAX_SAFE_INTEGER);
const fenceThresholdSchema = z
	.object({
		limitExclusiveMs: z.literal(100),
		count: thresholdCount,
		below: thresholdCount,
		atOrAbove: thresholdCount,
	})
	.strict();

/**
 * Prove the strict fence p95 budget from raw-duration counts without rounding samples.
 * @param histogram Unchanged observer ceiling-millisecond distribution, bounded at 60001.
 * @param observation Required same-sample raw counts with the fixed exclusive 100 ms limit.
 * @returns Counts, nearest-rank p95 position and its exact threshold result; empty data fails.
 * @throws On missing/corrupt counts or disagreement with the histogram, including its boundary bin.
 * The histogram remains a conservative percentile upper bound, not an exact raw percentile.
 */
export function fenceThresholdEvidence(
	histogram: Record<string, number>,
	observation: unknown,
) {
	const counts = fenceThresholdSchema.parse(observation);
	let total = 0,
		certainlyBelow = 0,
		possiblyBelow = 0;
	for (const [key, frequency] of Object.entries(histogram)) {
		const upper = Number(key);
		if (
			!Number.isSafeInteger(upper) ||
			upper < 0 ||
			upper > 60001 ||
			String(upper) !== key ||
			!Number.isSafeInteger(frequency) ||
			frequency < 1
		)
			throw new Error("Invalid fence threshold histogram");
		total += frequency;
		if (upper < 100) certainlyBelow += frequency;
		if (upper <= 100) possiblyBelow += frequency;
	}
	if (
		!Number.isSafeInteger(total) ||
		counts.count !== total ||
		counts.atOrAbove !== counts.count - counts.below ||
		counts.below < certainlyBelow ||
		counts.below > possiblyBelow
	)
		throw new Error("Fence threshold counts disagree with histogram");
	// ceil(95 * count / 100), without multiplying a potentially large integer.
	const p95Rank = counts.count - Math.floor(counts.count / 20);
	return {
		...counts,
		valid: true,
		p95Rank,
		p95Passed: counts.count > 0 && counts.below >= p95Rank,
		method: "raw-duration-threshold-count" as const,
	};
}

type TenantProgress = { attempts: number; successes: number; maxGapMs: number };
type CommercialEvidence = {
	failures: number;
	imports: number;
	exports: number;
	usageVisibility: Statistics;
	completedDuringLoad: number;
	pending: number;
};
/** Evaluates the frozen reference workload, latency and fairness targets.
 * @param run Observed request/observer facts. Empty, incomplete and interrupted runs fail closed.
 * @returns Named independent gates; callers must require every value and exclude smoke from acceptance.
 */
export function performanceGates(run: {
	interrupted: boolean;
	authorizationValid: boolean;
	graphEmpty: boolean;
	sourceStable: boolean;
	durationMs: number;
	requiredDurationMs: number;
	attempts: number;
	successes: number;
	read: Statistics;
	write: Statistics;
	fence: Statistics;
	fenceThreshold: ReturnType<typeof fenceThresholdEvidence>;
	create: Statistics;
	sourceCommit: Statistics;
	revocation: Statistics;
	observerValid: boolean;
	revocationFence: Statistics;
	sparseLists: number;
	sparseRows: number;
	tenants: TenantProgress[];
	hotRequests: number;
	operations: Record<string, number>;
	commercial: CommercialEvidence;
	smoke: boolean;
}) {
	const under = (stats: Statistics, limit: number) =>
		stats.count > 0 && stats.p95 !== null && stats.p95 < limit;
	const fenceProofValid =
		run.fenceThreshold?.valid === true &&
		run.fenceThreshold.count === run.fence.count;
	const mix = (names: string[]) =>
		names.reduce((n, key) => n + (run.operations[key] ?? 0), 0) / run.attempts;
	return {
		completed: !run.interrupted && run.durationMs >= run.requiredDurationMs,
		sustainedProfile: run.smoke || run.requiredDurationMs >= 1800000,
		availability: run.attempts > 0 && run.successes / run.attempts >= 0.999,
		readLatency: under(run.read, 500),
		writeLatency: under(run.write, 800),
		fenceWait:
			run.fence.count > 0 && fenceProofValid && run.fenceThreshold.p95Passed,
		createToReadable: under(run.create, 2000),
		sourceReadiness: under(run.sourceCommit, 2000),
		authorization:
			run.authorizationValid &&
			run.graphEmpty &&
			run.observerValid &&
			fenceProofValid &&
			run.revocation.count > 0 &&
			run.revocationFence.count > 0,
		sourceStable: run.sourceStable,
		sparseAuthorization: run.sparseLists > 0 && run.sparseRows > 0,
		hotDistribution: Math.abs(run.hotRequests / run.attempts - 0.8) <= 0.05,
		canonicalMix:
			Math.abs(mix(["read", "list"]) - 0.6) <= 0.02 &&
			Math.abs(mix(["update"]) - 0.2) <= 0.02 &&
			Math.abs(mix(["create", "delete"]) - 0.1) <= 0.02 &&
			Math.abs(mix(["share", "revoke"]) - 0.1) <= 0.02,
		tenantFairness:
			run.tenants.length === 100 &&
			run.tenants.every(
				(t) => t.attempts > 0 && t.successes > 0 && t.maxGapMs <= 60000,
			),
		commercialContention:
			run.commercial.failures === 0 &&
			run.commercial.imports > 0 &&
			run.commercial.exports > 0 &&
			run.commercial.completedDuringLoad > 0 &&
			run.commercial.pending === 0,
		usageVisibility: under(run.commercial.usageVisibility, 60000),
	};
}
