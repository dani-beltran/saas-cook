import { describe, expect, it } from "vitest";
import {
	assertAuthorizedExport,
	assertSparsePage,
	checkFinalPerformanceSource,
	finalPerformanceOutcome,
} from "./performance-assertions";

const permittedIds = new Set(["allowed-a", "allowed-b"]);

describe("source evidence after cleanup", () => {
	const before = {
		commit: "a".repeat(40),
		fingerprint: "b".repeat(64),
		dirty: false,
	};
	it.each([false, true])(
		"retains unchanged source metadata with initial dirty state %s",
		async (dirty) => {
			const source = { ...before, dirty };
			await expect(
				checkFinalPerformanceSource(source, true, async () => ({ ...source })),
			).resolves.toEqual({ sourceStable: true, sourceAfterCleanup: source });
		},
	);
	it.each([
		{ commit: "c".repeat(40) },
		{ fingerprint: "d".repeat(64) },
		{ dirty: true },
	])("fails for final source changes %j", async (change) => {
		const after = { ...before, ...change };
		const result = await checkFinalPerformanceSource(
			before,
			true,
			async () => after,
		);
		expect(result).toEqual({ sourceStable: false, sourceAfterCleanup: after });
		expect(
			finalPerformanceOutcome({
				status: "passed",
				smoke: false,
				checks: { sourceStable: result.sourceStable },
				cleanupPassed: true,
			}),
		).toMatchObject({ status: "failed", acceptanceEligible: false });
	});
	it("does not restore a prior failure when source changes are reverted", async () => {
		await expect(
			checkFinalPerformanceSource(before, false, async () => before),
		).resolves.toEqual({ sourceStable: false, sourceAfterCleanup: before });
		await expect(
			checkFinalPerformanceSource(
				{ ...before, dirty: true },
				true,
				async () => before,
			),
		).resolves.toEqual({ sourceStable: false, sourceAfterCleanup: before });
	});
	it("returns a failed source gate when reading Git state fails so evidence can be retained", async () => {
		const result = await checkFinalPerformanceSource(before, true, async () => {
			throw new Error("Untrusted command output must not enter the report");
		});
		expect(result).toEqual({ sourceStable: false, sourceAfterCleanup: null });
		expect(
			finalPerformanceOutcome({
				status: "passed",
				smoke: true,
				checks: { sourceStable: result.sourceStable },
				cleanupPassed: true,
			}),
		).toMatchObject({ status: "failed", acceptanceEligible: false });
	});
});

function download(rows: string[]) {
	return {
		filename: "projects.csv",
		contentType: "text/csv",
		base64: Buffer.from(
			`id,name,slug,description,status\r\n${rows.join("\r\n")}\r\n`,
		).toString("base64"),
	};
}
describe("independent authorization assertions in image load", () => {
	it("allows empty continuing sparse pages but rejects leaked or duplicated rows", () => {
		expect(() => assertSparsePage([], permittedIds)).not.toThrow();
		expect(() =>
			assertSparsePage([{ id: "allowed-a" }], permittedIds),
		).not.toThrow();
		expect(() =>
			assertSparsePage(
				[{ id: "allowed-a" }, { id: "forbidden" }],
				permittedIds,
			),
		).toThrow("unauthorized");
		expect(() =>
			assertSparsePage(
				[{ id: "allowed-a" }, { id: "allowed-a" }],
				permittedIds,
			),
		).toThrow("duplicated");
	});
	it("requires exactly the permitted CSV IDs even if other cells contain expected ID text", () => {
		const a = "allowed-a,Project A,a,description,active",
			b = "allowed-b,Project B,b,description,active";
		expect(() =>
			assertAuthorizedExport(download([b, a]), permittedIds),
		).not.toThrow();
		expect(() => assertAuthorizedExport(download([a]), permittedIds)).toThrow(
			"row count",
		);
		expect(() =>
			assertAuthorizedExport(
				download([a, b, "forbidden,Secret,c,description,active"]),
				permittedIds,
			),
		).toThrow("row count");
		expect(() =>
			assertAuthorizedExport(download([a, a]), permittedIds),
		).toThrow("duplicated");
		expect(() =>
			assertAuthorizedExport(
				download([a, "forbidden,Secret,c,allowed-b,active"]),
				permittedIds,
			),
		).toThrow("unauthorized");
	});
	it("rejects unexpected CSV fields and accepts correctly quoted cell content", () => {
		const result = download([
			'allowed-a,"Project, A",a,description,active',
			"allowed-b,Project B,b,description,active",
		]);
		expect(() => assertAuthorizedExport(result, permittedIds)).not.toThrow();
		result.base64 = Buffer.from(
			"id,name,slug,secret,status\nallowed-a,A,a,x,active\nallowed-b,B,b,x,active\n",
		).toString("base64");
		expect(() => assertAuthorizedExport(result, permittedIds)).toThrow();
	});
});
describe("final acceptance eligibility after cleanup", () => {
	const completed = {
		status: "passed",
		smoke: false,
		checks: { execution: true },
		cleanupPassed: true,
	};
	it("invalidates a formerly eligible full run when cleanup fails", () => {
		expect(finalPerformanceOutcome(completed)).toEqual({
			status: "passed",
			acceptanceEligible: true,
			cleanupPassed: true,
		});
		expect(
			finalPerformanceOutcome({ ...completed, cleanupPassed: false }),
		).toEqual({
			status: "failed",
			acceptanceEligible: false,
			cleanupPassed: false,
		});
	});
	it("keeps smoke, interrupted, failed-check and empty-check results ineligible", () => {
		const changes: Partial<Parameters<typeof finalPerformanceOutcome>[0]>[] = [
			{ smoke: true },
			{ status: "interrupted" },
			{ checks: { execution: false } },
			{ checks: {} },
		];
		for (const change of changes)
			expect(
				finalPerformanceOutcome({ ...completed, ...change }).acceptanceEligible,
			).toBe(false);
	});
});
