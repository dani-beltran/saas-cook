import { describe, expect, it } from "vitest";
import {
	fenceThresholdEvidence,
	histogramStatistics,
	latencyStatistics,
	performanceGates,
} from "./performance-metrics";

function healthy() {
	const low = latencyStatistics([1, 2, 3, 4, 5]);
	return {
		interrupted: false,
		authorizationValid: true,
		graphEmpty: true,
		sourceStable: true,
		durationMs: 1800000,
		requiredDurationMs: 1800000,
		attempts: 10000,
		successes: 10000,
		read: low,
		write: low,
		fence: low,
		fenceThreshold: fenceThresholdEvidence(
			{ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
			{ limitExclusiveMs: 100, count: 5, below: 5, atOrAbove: 0 },
		),
		create: low,
		sourceCommit: low,
		revocation: low,
		observerValid: true,
		revocationFence: low,
		sparseLists: 100,
		sparseRows: 100,
		tenants: Array.from({ length: 100 }, () => ({
			attempts: 100,
			successes: 100,
			maxGapMs: 1000,
		})),
		hotRequests: 8000,
		operations: {
			read: 4000,
			list: 2000,
			update: 2000,
			create: 500,
			delete: 500,
			share: 500,
			revoke: 500,
		},
		commercial: {
			failures: 0,
			imports: 15,
			exports: 15,
			usageVisibility: low,
			completedDuringLoad: 30,
			pending: 0,
		},
		smoke: false,
	};
}
describe("image performance evidence gates", () => {
	it("rejects empty telemetry instead of reporting zero latency", () => {
		expect(latencyStatistics([])).toEqual({
			count: 0,
			p95: null,
			p99: null,
			max: null,
		});
		expect(histogramStatistics({})).toEqual({
			count: 0,
			p95: null,
			p99: null,
			max: null,
		});
		expect(
			performanceGates({ ...healthy(), fence: histogramStatistics({}) })
				.fenceWait,
		).toBe(false);
	});
	it("preserves tail latency and rejects corrupt aggregate counts", () => {
		expect(histogramStatistics({ 1: 94, 99: 5, 1000: 1 }, 999.2)).toEqual({
			count: 100,
			p95: 99,
			p99: 99,
			max: 999.2,
		});
		expect(() => histogramStatistics({ 1: -1 })).toThrow(
			"Invalid performance histogram",
		);
		expect(() => histogramStatistics({ invalid: 1 })).toThrow(
			"Invalid performance histogram",
		);
	});
	it("requires full duration, first-attempt availability and every reference gate", () => {
		expect(Object.values(performanceGates(healthy())).every(Boolean)).toBe(
			true,
		);
		expect(
			performanceGates({ ...healthy(), durationMs: 1799999 }).completed,
		).toBe(false);
		expect(
			performanceGates({ ...healthy(), requiredDurationMs: 15000 })
				.sustainedProfile,
		).toBe(false);
		expect(
			performanceGates({ ...healthy(), successes: 9989 }).availability,
		).toBe(false);
		expect(
			performanceGates({ ...healthy(), interrupted: true }).completed,
		).toBe(false);
		expect(
			performanceGates({ ...healthy(), sourceStable: false }).sourceStable,
		).toBe(false);
	});
	it("does not hide a starved cold tenant behind aggregate throughput", () => {
		const run = healthy();
		run.tenants[99].maxGapMs = 60001;
		expect(performanceGates(run).tenantFairness).toBe(false);
		run.tenants[99] = { attempts: 1, successes: 0, maxGapMs: 1000 };
		expect(performanceGates(run).tenantFairness).toBe(false);
	});
	it("requires real revocations, sparse authorized rows and canonical traffic", () => {
		expect(
			performanceGates({ ...healthy(), revocationFence: latencyStatistics([]) })
				.authorization,
		).toBe(false);
		expect(
			performanceGates({ ...healthy(), sparseRows: 0 }).sparseAuthorization,
		).toBe(false);
		expect(
			performanceGates({ ...healthy(), hotRequests: 5000 }).hotDistribution,
		).toBe(false);
		expect(
			performanceGates({ ...healthy(), operations: { read: 10000 } })
				.canonicalMix,
		).toBe(false);
	});
	it("requires completed concurrent imports/exports, visible usage and bounded drain", () => {
		for (const change of [
			{ failures: 1 },
			{ imports: 0 },
			{ exports: 0 },
			{ completedDuringLoad: 0 },
			{ pending: 1 },
		])
			expect(
				performanceGates({
					...healthy(),
					commercial: { ...healthy().commercial, ...change },
				}).commercialContention,
			).toBe(false);
		expect(
			performanceGates({
				...healthy(),
				commercial: {
					...healthy().commercial,
					usageVisibility: latencyStatistics([60000]),
				},
			}).usageVisibility,
		).toBe(false);
	});
});

describe("exact fence threshold evidence", () => {
	it("distinguishes a below-budget p95 from an exact-limit p95 in the same ceiling bin", () => {
		const histogram = { 99: 94, 100: 1, 101: 5 };
		const fence = histogramStatistics(histogram, 100.001);
		expect(fence.p95).toBe(100);
		const below = fenceThresholdEvidence(histogram, {
			limitExclusiveMs: 100,
			count: 100,
			below: 95,
			atOrAbove: 5,
		});
		const exact = fenceThresholdEvidence(histogram, {
			limitExclusiveMs: 100,
			count: 100,
			below: 94,
			atOrAbove: 6,
		});
		expect(below).toMatchObject({ p95Rank: 95, p95Passed: true });
		expect(exact).toMatchObject({ p95Rank: 95, p95Passed: false });
		expect(
			performanceGates({ ...healthy(), fence, fenceThreshold: below })
				.fenceWait,
		).toBe(true);
		expect(
			performanceGates({ ...healthy(), fence, fenceThreshold: exact })
				.fenceWait,
		).toBe(false);
	});
	it("keeps proof validity mandatory independently of the fence latency result", () => {
		const run = healthy();
		for (const fenceThreshold of [
			undefined,
			{ ...run.fenceThreshold, valid: false },
			{ ...run.fenceThreshold, count: run.fence.count + 1 },
		]) {
			const gates = performanceGates({
				...run,
				fenceThreshold: fenceThreshold as typeof run.fenceThreshold,
			});
			expect(gates.authorization).toBe(false);
			expect(gates.fenceWait).toBe(false);
		}
		const histogram = { 111: 20 };
		const gates = performanceGates({
			...run,
			fence: histogramStatistics(histogram, 110.5),
			fenceThreshold: fenceThresholdEvidence(histogram, {
				limitExclusiveMs: 100,
				count: 20,
				below: 0,
				atOrAbove: 20,
			}),
		});
		expect(gates.authorization).toBe(true);
		expect(gates.fenceWait).toBe(false);
	});
	it("uses the nearest rank for a non-multiple of twenty without discarding slow samples", () => {
		const histogram = { 99: 3151, 100: 7, 101: 160 };
		for (const [below, passed] of [
			[3152, false],
			[3153, true],
		] as const) {
			const result = fenceThresholdEvidence(histogram, {
				limitExclusiveMs: 100,
				count: 3318,
				below,
				atOrAbove: 3318 - below,
			});
			expect(result.p95Rank).toBe(3153);
			expect(result.p95Passed).toBe(passed);
		}
	});
	it("keeps empty but internally valid web telemetry an authorization failure", () => {
		const fence = histogramStatistics({});
		const fenceThreshold = fenceThresholdEvidence(
			{},
			{ limitExclusiveMs: 100, count: 0, below: 0, atOrAbove: 0 },
		);
		const result = performanceGates({ ...healthy(), fence, fenceThreshold });
		expect(fenceThreshold.valid).toBe(true);
		expect(result.fenceWait).toBe(false);
		expect(result.authorization).toBe(false);
	});
	it("does not admit an empty or mismatched sample population", () => {
		const empty = fenceThresholdEvidence(
			{},
			{
				limitExclusiveMs: 100,
				count: 0,
				below: 0,
				atOrAbove: 0,
			},
		);
		expect(empty.p95Passed).toBe(false);
		expect(
			performanceGates({ ...healthy(), fenceThreshold: empty }).fenceWait,
		).toBe(false);
	});
	it.each([
		undefined,
		null,
		{},
		{ limitExclusiveMs: 101, count: 100, below: 95, atOrAbove: 5 },
		{ limitExclusiveMs: 100, count: 99, below: 94, atOrAbove: 5 },
		{ limitExclusiveMs: 100, count: 100, below: 95, atOrAbove: 6 },
		{ limitExclusiveMs: 100, count: 100, below: -1, atOrAbove: 101 },
		{ limitExclusiveMs: 100, count: 100, below: 94.5, atOrAbove: 5.5 },
		{
			limitExclusiveMs: 100,
			count: Number.MAX_SAFE_INTEGER + 1,
			below: 95,
			atOrAbove: 5,
		},
		{ limitExclusiveMs: 100, count: 100, below: 93, atOrAbove: 7 },
		{ limitExclusiveMs: 100, count: 100, below: 96, atOrAbove: 4 },
		{
			limitExclusiveMs: 100,
			count: 100,
			below: 95,
			atOrAbove: 5,
			unexpected: true,
		},
	])(
		"rejects missing, corrupt or histogram-inconsistent counters: %j",
		(counts) => {
			expect(() =>
				fenceThresholdEvidence({ 99: 94, 100: 1, 101: 5 }, counts),
			).toThrow();
		},
	);
	it.each([
		{ "99.5": 1 },
		{ "099": 1 },
		{ "60002": 1 },
		{ "-1": 1 },
		{ 100: 0 },
		{ 100: 1.5 },
		{ 100: Number.MAX_SAFE_INTEGER + 1 },
	] as Record<string, number>[])(
		"rejects invalid histogram bins or frequencies: %j",
		(histogram) => {
			expect(() =>
				fenceThresholdEvidence(histogram, {
					limitExclusiveMs: 100,
					count: 1,
					below: 0,
					atOrAbove: 1,
				}),
			).toThrow();
		},
	);
});
