import { describe, expect, it } from "vitest";
import {
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
