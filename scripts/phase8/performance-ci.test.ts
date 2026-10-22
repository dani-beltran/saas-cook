import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeEvidence } from "./evidence";
import {
	ciCorrectnessOutcome,
	performanceMode,
	writeCiCorrectnessEvidence,
} from "./performance-ci";

const gateNames = [
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
	"cleanSource",
	"dependencyHealth",
	"environmentCleanup",
	"cleanup",
];
const healthy = () => ({
	gate: "performance-smoke",
	status: "passed",
	dirty: false,
	imagePresent: true,
	measuredWorkload: true,
	fenceTelemetryValid: true,
	checks: Object.fromEntries(gateNames.map((name) => [name, true])),
});
const failedCrud = (): ReturnType<typeof healthy> => ({
	...healthy(),
	status: "failed",
	checks: { ...healthy().checks, readLatency: false, writeLatency: false },
});
const outputs: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(outputs.splice(0).map((path) => rm(path, { force: true })));
});
describe("explicit CI smoke mode", () => {
	it.each([
		[[], "full"],
		[["--smoke"], "smoke"],
		[["--ci-smoke"], "ci-smoke"],
	] as const)("selects only declared mode %j", (args, mode) => {
		expect(performanceMode(args)).toBe(mode);
	});
	it.each([
		["--smoke", "--ci-smoke"],
		["--ci-smoke", "--ci-smoke"],
		["--smoke", "--smoke"],
		["--duration=1"],
		["--ci"],
		["--full"],
	])("rejects ambiguous or adjustable mode %j", (...args) => {
		expect(() => performanceMode(args)).toThrow("Usage");
	});
});
describe("independent CI correctness outcome", () => {
	it("preserves failed read/write targets while keeping CI permanently release-ineligible", () => {
		expect(ciCorrectnessOutcome(failedCrud())).toMatchObject({
			status: "passed",
			acceptanceEligible: false,
			referenceTargetFailures: ["readLatency", "writeLatency"],
		});
		expect(ciCorrectnessOutcome(healthy())).toMatchObject({
			status: "passed",
			acceptanceEligible: false,
		});
	});
	it("allows only a valid slow fence latency result alongside CRUD timing misses", () => {
		const run = failedCrud();
		run.checks.fenceWait = false;
		expect(ciCorrectnessOutcome(run)).toMatchObject({
			status: "passed",
			acceptanceEligible: false,
			referenceTargetFailures: ["readLatency", "writeLatency", "fenceWait"],
		});
		for (const invalid of [false, undefined, "true"]) {
			expect(
				ciCorrectnessOutcome({
					...run,
					fenceTelemetryValid: invalid as boolean,
				}).status,
			).toBe("failed");
		}
	});
	it.each(
		gateNames.filter(
			(name) => !["readLatency", "writeLatency", "fenceWait"].includes(name),
		),
	)("still fails for %s", (name) => {
		const run = failedCrud();
		run.checks[name] = false;
		expect(ciCorrectnessOutcome(run).status).toBe("failed");
	});
	it("rejects unknown, omitted and nonboolean checks instead of silently narrowing coverage", () => {
		const unknown = failedCrud();
		unknown.checks.newGate = true;
		expect(ciCorrectnessOutcome(unknown).status).toBe("failed");
		const missing = failedCrud();
		delete missing.checks.readLatency;
		expect(ciCorrectnessOutcome(missing).status).toBe("failed");
		const invalid = JSON.parse(JSON.stringify(failedCrud()));
		invalid.checks.readLatency = "false";
		expect(ciCorrectnessOutcome(invalid).status).toBe("failed");
	});
	it.each([
		{ gate: "performance-full" },
		{ status: "passed" },
		{ status: "interrupted" },
		{ dirty: true },
		{ imagePresent: false },
		{ measuredWorkload: false },
		{ fenceTelemetryValid: false },
	])("fails closed for inconsistent evidence %j", (change) => {
		expect(ciCorrectnessOutcome({ ...failedCrud(), ...change }).status).toBe(
			"failed",
		);
	});
});
function fenceMeasurement(ms = 54) {
	return {
		count: 100,
		p95: ms,
		p99: ms,
		max: ms,
		percentileRepresentation: "conservative-ceiling-ms-upper-bound",
		threshold: {
			limitExclusiveMs: 100,
			count: 100,
			below: ms < 100 ? 100 : 0,
			atOrAbove: ms < 100 ? 0 : 100,
			p95Rank: 95,
			p95Passed: ms < 100,
			valid: true,
			method: "raw-duration-threshold-count",
		},
	};
}
function fenceObservation(role: string, ms = 54) {
	return {
		role,
		fence: { [ms]: 100 },
		maxFence: ms,
		fenceThreshold: {
			limitExclusiveMs: 100,
			count: 100,
			below: ms < 100 ? 100 : 0,
			atOrAbove: ms < 100 ? 0 : 100,
		},
	};
}
type FenceReport = {
	telemetry: ReturnType<typeof fenceObservation>[];
	latencyMs: { fenceWait: ReturnType<typeof fenceMeasurement> };
};
async function evidenceFixture(
	reportChanges: Record<string, unknown> = {},
	checkChanges: Record<string, boolean> = {},
	withEnvironment = false,
) {
	await mkdir("artifacts/phase8", { recursive: true });
	const reportPath = `artifacts/phase8/ci-proposal-test-${randomUUID()}.json`;
	const ciReport = `artifacts/phase8/ci-proposal-test-${randomUUID()}.json`;
	outputs.push(reportPath, ciReport);
	const environmentPaths = withEnvironment
		? [`artifacts/phase8/ci-environment-test-${randomUUID()}.json`]
		: [];
	for (const path of environmentPaths) {
		await writeFile(path, JSON.stringify({ cleanupPassed: true }));
		outputs.push(path);
	}
	const metric = (p95: number) => ({
		count: 10,
		p95,
		p99: p95 + 1,
		max: p95 + 2,
	});
	await writeFile(
		reportPath,
		JSON.stringify({
			status: "failed",
			acceptanceEligible: false,
			durationSeconds: 30.1,
			warmupMs: 2000,
			clients: 50,
			tenants: 100,
			memberships: 1000,
			projects: 100000,
			workloadVersion: "direct-project-http-commercial-v1",
			latencyMs: {
				read: metric(619.6),
				write: metric(1204.9),
				fenceWait: fenceMeasurement(),
			},
			graph: { worker: { fenceWait: fenceMeasurement() } },
			telemetry: [fenceObservation("web"), fenceObservation("worker")],
			...reportChanges,
		}),
	);
	const source = {
		commit: "a".repeat(40),
		fingerprint: "b".repeat(64),
		dirty: false,
	};
	const receiptPath = await writeEvidence(
		{
			gate: "performance-smoke",
			preset: "commercial-local",
			source,
			startedAt: "2026-10-22T00:00:00.000Z",
			outcome: "failed",
			limitations: [],
			image: {
				id: `sha256:${"c".repeat(64)}`,
				architecture: "amd64",
				os: "linux",
				revision: source.commit,
				fingerprint: source.fingerprint,
			},
			checks: Object.entries({ ...failedCrud().checks, ...checkChanges }).map(
				([name, passed]) => ({ name, passed }),
			),
		},
		[reportPath, ...environmentPaths],
	);
	outputs.push(receiptPath);
	return { reportPath, ciReport, receiptPath, environmentPaths };
}
describe("retained strict and CI receipts", () => {
	it("retains and hashes isolated-environment evidence alongside the exact measurement report", async () => {
		const f = await evidenceFixture({}, {}, true);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await writeCiCorrectnessEvidence(
			f.receiptPath,
			f.ciReport,
			f.reportPath,
		);
		outputs.push(result.receiptPath);
		expect(result.status).toBe("passed");
		const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
		expect(receipt.artifacts.map(({ path }: { path: string }) => path)).toEqual(
			[f.ciReport, f.receiptPath, f.reportPath, ...f.environmentPaths],
		);
	});
	it("rejects changed environment evidence and an unbound measurement path", async () => {
		const f = await evidenceFixture({}, {}, true);
		await expect(
			writeCiCorrectnessEvidence(f.receiptPath, f.ciReport, f.ciReport),
		).rejects.toThrow("actual strict smoke receipt");
		await writeFile(f.environmentPaths[0], "{}");
		await expect(
			writeCiCorrectnessEvidence(f.receiptPath, f.ciReport, f.reportPath),
		).rejects.toThrow("digest mismatch");
	});
	it("keeps the strict failed bytes, measured warnings and links both receipts to the exact report", async () => {
		const f = await evidenceFixture();
		const prior = await readFile(f.receiptPath);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await writeCiCorrectnessEvidence(
			f.receiptPath,
			f.ciReport,
			f.reportPath,
		);
		outputs.push(result.receiptPath);
		expect(result.status).toBe("passed");
		expect(await readFile(f.receiptPath)).toEqual(prior);
		const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
		expect(receipt.gate).toBe("performance-ci-correctness");
		expect(receipt.artifacts.map(({ path }: { path: string }) => path)).toEqual(
			[f.ciReport, f.receiptPath, f.reportPath],
		);
		const warned = JSON.parse(String(warning.mock.calls[0]?.[0]));
		expect(warned.warning).toContain("Strict performance smoke FAILED");
		expect(warned.failedLatencyTargets).toEqual([
			{ check: "readLatency", p95Ms: 619.6, targetExclusiveMs: 500 },
			{ check: "writeLatency", p95Ms: 1204.9, targetExclusiveMs: 800 },
		]);
	});
	it.each([
		{ durationSeconds: 1 },
		{ clients: 1 },
		{ latencyMs: {} },
		{ status: "passed" },
	])(
		"writes failed CI evidence for incomplete or inconsistent measured work %j",
		async (change) => {
			const f = await evidenceFixture(change);
			vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.spyOn(console, "log").mockImplementation(() => {});
			const result = await writeCiCorrectnessEvidence(
				f.receiptPath,
				f.ciReport,
				f.reportPath,
			);
			outputs.push(result.receiptPath);
			expect(result.status).toBe("failed");
		},
	);
	it("preserves failed initialization/execution evidence as a failed CI result", async () => {
		const f = await evidenceFixture(
			{ stage: "fixture-initialization", latencyMs: null },
			{ execution: false },
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await writeCiCorrectnessEvidence(
			f.receiptPath,
			f.ciReport,
			f.reportPath,
		);
		outputs.push(result.receiptPath);
		expect(result.status).toBe("failed");
	});
	it("keeps strict slow-fence evidence failed and warns with measured timing and raw threshold proof", async () => {
		const f = await evidenceFixture(
			{
				latencyMs: {
					read: { count: 10, p95: 619.6, p99: 620.6, max: 621.6 },
					write: { count: 10, p95: 1204.9, p99: 1205.9, max: 1206.9 },
					fenceWait: fenceMeasurement(111),
				},
				telemetry: [fenceObservation("web", 111), fenceObservation("worker")],
			},
			{ fenceWait: false },
		);
		const original = await readFile(f.receiptPath);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await writeCiCorrectnessEvidence(
			f.receiptPath,
			f.ciReport,
			f.reportPath,
		);
		outputs.push(result.receiptPath);
		expect(result).toMatchObject({
			status: "passed",
			acceptanceEligible: false,
			checks: { fenceTelemetryValid: true },
		});
		expect(await readFile(f.receiptPath)).toEqual(original);
		const report = JSON.parse(await readFile(f.ciReport, "utf8"));
		expect(report.strictPerformanceOutcome).toBe("failed");
		expect(report.diagnosticOnlyChecks).toEqual([
			"readLatency",
			"writeLatency",
			"fenceWait",
		]);
		expect(
			JSON.parse(String(warning.mock.calls[0][0])).failedLatencyTargets,
		).toContainEqual({
			check: "fenceWait",
			p95Ms: 111,
			targetExclusiveMs: 100,
			percentileRepresentation: "conservative-ceiling-ms-upper-bound",
			rawThreshold: fenceMeasurement(111).threshold,
		});
	});
	it.each([
		[
			"missing web telemetry",
			(r: FenceReport) => {
				r.telemetry = [r.telemetry[1]];
			},
		],
		[
			"duplicate web telemetry",
			(r: FenceReport) => {
				r.telemetry.push(r.telemetry[0]);
			},
		],
		[
			"missing worker telemetry",
			(r: FenceReport) => {
				r.telemetry.pop();
			},
		],
		[
			"missing raw proof",
			(r: FenceReport) => {
				Reflect.deleteProperty(r.telemetry[0], "fenceThreshold");
			},
		],
		[
			"counter total mismatch",
			(r: FenceReport) => {
				r.telemetry[0].fenceThreshold.count++;
			},
		],
		[
			"raw proof contradicts histogram",
			(r: FenceReport) => {
				r.telemetry[0].fenceThreshold.below = 0;
				r.telemetry[0].fenceThreshold.atOrAbove = 100;
			},
		],
		[
			"invalid worker proof",
			(r: FenceReport) => {
				r.telemetry[1].fenceThreshold.below = -1;
			},
		],
		[
			"corrupt histogram",
			(r: FenceReport) => {
				r.telemetry[0].fence = { 54: 0.5 };
			},
		],
		[
			"missing proof validity",
			(r: FenceReport) => {
				Reflect.deleteProperty(r.latencyMs.fenceWait.threshold, "valid");
			},
		],
		[
			"false proof validity",
			(r: FenceReport) => {
				r.latencyMs.fenceWait.threshold.valid = false;
			},
		],
		[
			"forged threshold result",
			(r: FenceReport) => {
				r.latencyMs.fenceWait.threshold.p95Passed = false;
			},
		],
		[
			"forged threshold rank",
			(r: FenceReport) => {
				r.latencyMs.fenceWait.threshold.p95Rank = 1;
			},
		],
		[
			"changed fence percentile",
			(r: FenceReport) => {
				r.latencyMs.fenceWait.p95 = 55;
			},
		],
		[
			"empty web samples",
			(r: FenceReport) => {
				r.telemetry[0].fence = {};
				r.telemetry[0].fenceThreshold = {
					limitExclusiveMs: 100,
					count: 0,
					below: 0,
					atOrAbove: 0,
				};
			},
		],
	])(
		"rejects %s independently of diagnostic fence timing",
		async (_name, mutate) => {
			const f = await evidenceFixture();
			const report = JSON.parse(await readFile(f.reportPath, "utf8"));
			mutate(report);
			const corrupted = await evidenceFixture(report);
			vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.spyOn(console, "log").mockImplementation(() => {});
			const result = await writeCiCorrectnessEvidence(
				corrupted.receiptPath,
				corrupted.ciReport,
				corrupted.reportPath,
			);
			outputs.push(result.receiptPath);
			expect(result.status).toBe("failed");
			expect(result.checks.fenceTelemetryValid).toBe(false);
		},
	);
	it("requires a positive web population even when every empty proof field agrees", async () => {
		const empty = {
			count: 0,
			p95: null,
			p99: null,
			max: null,
			percentileRepresentation: "conservative-ceiling-ms-upper-bound",
			threshold: {
				limitExclusiveMs: 100,
				count: 0,
				below: 0,
				atOrAbove: 0,
				p95Rank: 0,
				p95Passed: false,
				valid: true,
				method: "raw-duration-threshold-count",
			},
		};
		const rawEmpty = {
			role: "web",
			fence: {},
			maxFence: 0,
			fenceThreshold: {
				limitExclusiveMs: 100,
				count: 0,
				below: 0,
				atOrAbove: 0,
			},
		};
		const original = await evidenceFixture();
		const report = JSON.parse(await readFile(original.reportPath, "utf8"));
		report.latencyMs.fenceWait = empty;
		report.telemetry[0] = rawEmpty;
		const f = await evidenceFixture(report, { fenceWait: false });
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await writeCiCorrectnessEvidence(
			f.receiptPath,
			f.ciReport,
			f.reportPath,
		);
		outputs.push(result.receiptPath);
		expect(result.status).toBe("failed");
		expect(result.checks.fenceTelemetryValid).toBe(false);
	});
	it("allows valid empty worker telemetry without weakening the web population requirement", async () => {
		const original = await evidenceFixture();
		const report = JSON.parse(await readFile(original.reportPath, "utf8"));
		report.graph.worker.fenceWait = {
			count: 0,
			p95: null,
			p99: null,
			max: null,
			percentileRepresentation: "conservative-ceiling-ms-upper-bound",
			threshold: {
				limitExclusiveMs: 100,
				count: 0,
				below: 0,
				atOrAbove: 0,
				p95Rank: 0,
				p95Passed: false,
				valid: true,
				method: "raw-duration-threshold-count",
			},
		};
		report.telemetry[1] = {
			role: "worker",
			fence: {},
			maxFence: 0,
			fenceThreshold: {
				limitExclusiveMs: 100,
				count: 0,
				below: 0,
				atOrAbove: 0,
			},
		};
		const f = await evidenceFixture(report);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await writeCiCorrectnessEvidence(
			f.receiptPath,
			f.ciReport,
			f.reportPath,
		);
		outputs.push(result.receiptPath);
		expect(result.status).toBe("passed");
	});
	it("rejects a strict fence outcome inconsistent with valid raw proof", async () => {
		const f = await evidenceFixture({}, { fenceWait: false });
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await writeCiCorrectnessEvidence(
			f.receiptPath,
			f.ciReport,
			f.reportPath,
		);
		outputs.push(result.receiptPath);
		expect(result.status).toBe("failed");
		expect(result.checks.fenceTelemetryValid).toBe(false);
	});
	it("rejects a changed raw report before creating a CI interpretation", async () => {
		const f = await evidenceFixture();
		await writeFile(f.reportPath, "{}");
		await expect(
			writeCiCorrectnessEvidence(f.receiptPath, f.ciReport, f.reportPath),
		).rejects.toThrow("digest mismatch");
	});
});
