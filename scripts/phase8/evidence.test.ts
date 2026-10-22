import { describe, expect, it } from "vitest";
import { evidenceSchema } from "./evidence";

const source = {
	commit: "a".repeat(40),
	fingerprint: "b".repeat(64),
	dirty: false,
};
const receipt = {
	version: 1,
	gate: "image",
	preset: "foundation",
	startedAt: "2026-10-22T00:00:00.000Z",
	finishedAt: "2026-10-22T00:01:00.000Z",
	outcome: "passed",
	source,
	checks: [{ name: "runtime", passed: true }],
	limitations: [],
	artifacts: [],
};
describe("release evidence integrity", () => {
	it("accepts a complete receipt with an immutable image bound to source", () => {
		expect(
			evidenceSchema.parse({
				...receipt,
				image: {
					id: `sha256:${"c".repeat(64)}`,
					architecture: "arm64",
					os: "linux",
					revision: source.commit,
					fingerprint: source.fingerprint,
				},
			}).outcome,
		).toBe("passed");
	});
	it("rejects missing checks, failed success, duplicate checks and reversed times", () => {
		for (const change of [
			{ checks: [] },
			{ checks: [{ name: "runtime", passed: false }] },
			{ checks: [receipt.checks[0], receipt.checks[0]] },
			{ finishedAt: "2026-10-21T00:00:00.000Z" },
		])
			expect(evidenceSchema.safeParse({ ...receipt, ...change }).success).toBe(
				false,
			);
	});
	it("rejects a stale image, unknown fields and credential-shaped labels", () => {
		expect(
			evidenceSchema.safeParse({
				...receipt,
				image: {
					id: `sha256:${"c".repeat(64)}`,
					architecture: "arm64",
					os: "linux",
					revision: source.commit,
					fingerprint: "d".repeat(64),
				},
			}).success,
		).toBe(false);
		expect(
			evidenceSchema.safeParse({ ...receipt, environment: { TOKEN: "secret" } })
				.success,
		).toBe(false);
		expect(
			evidenceSchema.safeParse({
				...receipt,
				gate: "https://user:password@host",
			}).success,
		).toBe(false);
	});
	it("retains a failed attempt without converting missing success into acceptance", () => {
		expect(
			evidenceSchema.parse({
				...receipt,
				outcome: "failed",
				checks: [{ name: "runtime", passed: false }],
			}).outcome,
		).toBe("failed");
	});
});
