import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkReleaseIndex, releaseGates } from "./release-check";

function fixture() {
	const files = new Map<string, Uint8Array>();
	const source = { commit: "a".repeat(40), fingerprint: "b".repeat(64) };
	const sha = (bytes: Uint8Array) =>
		createHash("sha256").update(bytes).digest("hex");
	const supporting = Buffer.from("actual check output");
	files.set("artifacts/report.json", supporting);
	const entries = releaseGates.map((gate) => {
		const receipt = `artifacts/${gate}.json`;
		const bytes = Buffer.from(
			JSON.stringify({
				version: 1,
				gate,
				preset: gate === "image-backoffice" ? "backoffice" : "commercial-local",
				source: { ...source, dirty: false },
				startedAt: "2026-10-22T00:00:00.000Z",
				finishedAt: "2026-10-22T00:01:00.000Z",
				outcome: "passed",
				checks: [{ name: "behavior", passed: true }],
				limitations: [],
				artifacts: [{ path: "artifacts/report.json", sha256: sha(supporting) }],
				...(gate.startsWith("image-") ||
				gate === "performance-full" ||
				gate === "recovery"
					? {
							image: {
								id: `sha256:${"c".repeat(64)}`,
								architecture: "amd64",
								os: "linux",
								revision: source.commit,
								fingerprint: source.fingerprint,
							},
						}
					: {}),
			}),
		);
		files.set(receipt, bytes);
		return { gate, receipt, sha256: sha(bytes) };
	});
	const index = { version: 1, source, entries };
	const read = async (name: string) => {
		const bytes = files.get(name);
		if (!bytes) throw new Error("Missing");
		return bytes;
	};
	return { files, index, read, sha };
}
describe("release completion cannot be inferred from partial evidence", () => {
	it("accepts a complete immutable index without granting release acceptance", async () => {
		const f = fixture();
		await expect(checkReleaseIndex(f.index, f.read)).resolves.toEqual(f.index);
	});
	it("rejects CI correctness evidence in place of the mandatory full performance gate", async () => {
		const f = fixture();
		const entry = f.index.entries.find(
			({ gate }) => gate === "performance-full",
		);
		if (!entry) throw new Error("Missing full performance test fixture");
		const receipt = JSON.parse(
			Buffer.from(await f.read(entry.receipt)).toString("utf8"),
		);
		receipt.gate = "performance-ci-correctness";
		const bytes = Buffer.from(JSON.stringify(receipt));
		f.files.set(entry.receipt, bytes);
		entry.sha256 = f.sha(bytes);
		await expect(checkReleaseIndex(f.index, f.read)).rejects.toThrow(
			"different gate",
		);
		await expect(
			checkReleaseIndex(
				{
					...f.index,
					entries: f.index.entries.map((value) =>
						value === entry
							? { ...value, gate: "performance-ci-correctness" }
							: value,
					),
				},
				f.read,
			),
		).rejects.toThrow();
	});
	it("rejects omitted, duplicated and stale gates", async () => {
		const f = fixture();
		await expect(
			checkReleaseIndex(
				{ ...f.index, entries: f.index.entries.slice(1) },
				f.read,
			),
		).rejects.toThrow();
		await expect(
			checkReleaseIndex(
				{ ...f.index, entries: f.index.entries.map(() => f.index.entries[0]) },
				f.read,
			),
		).rejects.toThrow();
		await expect(
			checkReleaseIndex(
				{ ...f.index, source: { ...f.index.source, commit: "d".repeat(40) } },
				f.read,
			),
		).rejects.toThrow();
	});
	it("rejects changed supporting artifacts even when the receipts are untouched", async () => {
		const f = fixture();
		f.files.set("artifacts/report.json", Buffer.from("tampered"));
		await expect(checkReleaseIndex(f.index, f.read)).rejects.toThrow(
			"Supporting artifact digest mismatch",
		);
	});
	it("rejects a freshly hashed failed receipt", async () => {
		const f = fixture();
		const entry = f.index.entries[0];
		const receipt = JSON.parse(
			Buffer.from(await f.read(entry.receipt)).toString("utf8"),
		);
		receipt.outcome = "failed";
		const bytes = Buffer.from(JSON.stringify(receipt));
		f.files.set(entry.receipt, bytes);
		entry.sha256 = f.sha(bytes);
		await expect(checkReleaseIndex(f.index, f.read)).rejects.toThrow(
			"failed, stale, dirty",
		);
	});
	it("requires the declared preset and same customer image for workload and recovery evidence", async () => {
		for (const gate of ["performance-full", "recovery"] as const) {
			for (const change of ["preset", "missing-image", "id", "architecture"]) {
				const f = fixture();
				const entry = f.index.entries.find((entry) => entry.gate === gate);
				if (!entry) throw new Error("Missing test entry");
				const receipt = JSON.parse(
					Buffer.from(await f.read(entry.receipt)).toString("utf8"),
				);
				if (change === "preset") receipt.preset = "foundation";
				else if (change === "missing-image") delete receipt.image;
				else if (change === "id") receipt.image.id = `sha256:${"d".repeat(64)}`;
				else receipt.image.architecture = "arm64";
				const bytes = Buffer.from(JSON.stringify(receipt));
				f.files.set(entry.receipt, bytes);
				entry.sha256 = f.sha(bytes);
				await expect(checkReleaseIndex(f.index, f.read)).rejects.toThrow();
			}
		}
	});
});
