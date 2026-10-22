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
	it.each(
		gateNames.filter((name) => !["readLatency", "writeLatency"].includes(name)),
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
	])("fails closed for inconsistent evidence %j", (change) => {
		expect(ciCorrectnessOutcome({ ...failedCrud(), ...change }).status).toBe(
			"failed",
		);
	});
});
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
			latencyMs: { read: metric(619.6), write: metric(1204.9) },
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
		expect(warned.failedCrudTargets).toEqual([
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
	it("rejects a changed raw report before creating a CI interpretation", async () => {
		const f = await evidenceFixture();
		await writeFile(f.reportPath, "{}");
		await expect(
			writeCiCorrectnessEvidence(f.receiptPath, f.ciReport, f.reportPath),
		).rejects.toThrow("digest mismatch");
	});
});
