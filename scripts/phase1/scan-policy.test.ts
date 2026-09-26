import { describe, expect, it } from "vitest";
import { evaluateScan } from "./scan-policy.js";

const report = {
	Results: [
		{
			Target: "bun.lock",
			Vulnerabilities: [
				{
					VulnerabilityID: "CVE-SYNTHETIC-1",
					PkgName: "synthetic",
					InstalledVersion: "1.0.0",
					Severity: "HIGH",
				},
			],
		},
	],
};
const exception = {
	id: "CVE-SYNTHETIC-1",
	package: "synthetic",
	version: "1.0.0",
	target: "bun.lock",
	scope: "dependencies",
	owner: "test-owner",
	review: "https://example.invalid/review/1",
	reason: "Synthetic policy validation fixture only",
	expires: "2026-10-01",
};
const now = new Date("2026-09-26T00:00:00Z");
describe("vulnerability policy", () => {
	it.each(["HIGH", "CRITICAL"])(
		"blocks %s findings even without an available fix",
		(severity) => {
			const findings = structuredClone(report);
			findings.Results[0].Vulnerabilities[0].Severity = severity;
			expect(
				evaluateScan(findings, { exceptions: [] }, "image", now),
			).toHaveLength(1);
		},
	);
	it("blocks high findings without an exact scoped exception", () => {
		expect(
			evaluateScan(report, { exceptions: [] }, "dependencies", now),
		).toHaveLength(1);
		expect(
			evaluateScan(report, { exceptions: [exception] }, "dependencies", now),
		).toHaveLength(0);
		expect(
			evaluateScan(report, { exceptions: [exception] }, "image", now),
		).toHaveLength(1);
		expect(
			evaluateScan(
				report,
				{ exceptions: [{ ...exception, version: "2.0.0" }] },
				"dependencies",
				now,
			),
		).toHaveLength(1);
	});
	it("rejects expired and excessively long exceptions", () => {
		expect(() =>
			evaluateScan(
				report,
				{ exceptions: [{ ...exception, expires: "2026-09-01" }] },
				"dependencies",
				now,
			),
		).toThrow("Expired");
		expect(() =>
			evaluateScan(
				report,
				{ exceptions: [{ ...exception, expires: "2027-09-01" }] },
				"dependencies",
				now,
			),
		).toThrow("90-day");
	});
	it("fails closed on missing scan results and malformed policy", () => {
		expect(() =>
			evaluateScan({}, { exceptions: [] }, "dependencies", now),
		).toThrow();
		expect(() =>
			evaluateScan(report, { exceptions: [{ id: "*" }] }, "dependencies", now),
		).toThrow();
	});
});
