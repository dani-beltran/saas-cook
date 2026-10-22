import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRetainedSkillEvidence } from "./skills-evidence-check";

const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
function fixture() {
	const files = new Map<string, Uint8Array>();
	const recordPaths = [
		"docs/phase4/evidence/release.json",
		"docs/phase5/evaluation-2026-10-19.json",
		"docs/phase6/evidence/acceptance-2026-10-21.json",
	];
	const evidenceRecords: Record<string, string> = {};
	for (const path of recordPaths) {
		const bytes = Buffer.from(JSON.stringify({ originalRecord: path }));
		files.set(path, bytes);
		evidenceRecords[path] = sha(bytes);
	}
	const source = {
		commit: "a".repeat(40),
		fingerprint: "b".repeat(64),
		dirty: false,
	};
	const review = "docs/phase8/template.md";
	const committedReview = Buffer.from(
		"Reviewed historical applicability and limits",
	);
	files.set(review, committedReview);
	const audit = {
		mode: "retained-independent-evidence-with-explicit-delta-review",
		freshAgentTrials: 0,
		skillHashes: { canonical: "c".repeat(64) },
		reviewedSkillHashes: { canonical: "c".repeat(64) },
		historicalFoundationSkillDifferences: [],
		phase5SkillsIdentical: false,
		changedPhase5Skills: [],
		phase6ReferenceHashes: {},
		changedPhase6References: [],
		evidenceRecords,
		review,
		limitations: [
			"Historical trials retain their original source and task scope",
		],
	};
	const checks = [
		"retained-agent-evidence-applicability",
		"skill-contracts-and-real-service-setup",
		"source-unchanged-during-verification",
	].map((name) => ({ name, passed: true }));
	const reportPath = "artifacts/phase8/template/attempt/report.json";
	const log = "artifacts/phase8/template/attempt/skills-check.log";
	files.set(
		log,
		Buffer.from("Retained successful full current skills check output"),
	);
	const report = {
		mode: "full",
		source: { ...source },
		skillEvidence: structuredClone(audit),
		checks: structuredClone(checks),
		commands: [
			{
				name: "skills-check",
				argv: ["bun", "run", "skills:check"],
				cwd: "source",
				exitCode: 0,
				log,
			},
		],
	};
	const receiptPath = "artifacts/phase8/receipts/template.json";
	const receipt = {
		version: 1,
		gate: "template",
		preset: "commercial-local",
		startedAt: "2026-10-22T00:00:00.000Z",
		finishedAt: "2026-10-22T00:01:00.000Z",
		outcome: "passed",
		source: { ...source },
		checks: structuredClone(checks),
		limitations: [],
		artifacts: [] as { path: string; sha256: string }[],
	};
	const save = () => {
		files.set(reportPath, Buffer.from(JSON.stringify(report)));
		receipt.artifacts = [reportPath, log].map((path) => {
			const bytes = files.get(path);
			if (!bytes) throw new Error("Fixture artifact missing");
			return { path, sha256: sha(bytes) };
		});
		files.set(receiptPath, Buffer.from(JSON.stringify(receipt)));
	};
	save();
	const read = async (path: string) => {
		const bytes = files.get(path);
		if (!bytes) throw new Error("Missing evidence input");
		return bytes;
	};
	const input = { receiptPath, source, audit, committedReview };
	return {
		input,
		read,
		files,
		receipt,
		report,
		reportPath,
		log,
		save,
		recordPaths,
	};
}

describe("retained independent skill evidence", () => {
	it("binds original bytes and committed review without requiring an image or fresh trials", async () => {
		const f = fixture();
		const result = await verifyRetainedSkillEvidence(f.input, f.read);
		expect(result.mode).toBe(
			"retained-independent-evidence-with-explicit-delta-review",
		);
		expect(result.freshAgentTrials).toBe(0);
		expect(result.receipt.image).toBeUndefined();
		expect(result.records.map(({ path }) => path)).toEqual(f.recordPaths);
		for (const retained of [
			result.template,
			result.review,
			...result.records,
			...result.artifacts,
		]) {
			expect(retained.bytes).toEqual(await f.read(retained.path));
			expect(retained.sha256).toBe(sha(retained.bytes));
		}
	});
	it.each(["template-smoke", "skills-contracts", "skills"])(
		"rejects the %s gate even with valid hashes",
		async (gate) => {
			const f = fixture();
			f.receipt.gate = gate;
			f.save();
			await expect(
				verifyRetainedSkillEvidence(f.input, f.read),
			).rejects.toThrow("full template receipt");
		},
	);
	it.each(["commit", "fingerprint", "dirty", "failed", "preset"])(
		"rejects wrong receipt %s",
		async (change) => {
			const f = fixture();
			if (change === "commit") f.receipt.source.commit = "d".repeat(40);
			else if (change === "fingerprint")
				f.receipt.source.fingerprint = "d".repeat(64);
			else if (change === "dirty") f.receipt.source.dirty = true;
			else if (change === "failed") f.receipt.outcome = "failed";
			else f.receipt.preset = "foundation";
			f.save();
			await expect(
				verifyRetainedSkillEvidence(f.input, f.read),
			).rejects.toThrow("full template receipt");
		},
	);
	it("rejects dirty current source even when the historical receipt is clean", async () => {
		const f = fixture();
		f.input.source.dirty = true;
		await expect(verifyRetainedSkillEvidence(f.input, f.read)).rejects.toThrow(
			"clean current source",
		);
	});
	it.each(["missing", "changed", "smoke", "wrong-source", "missing-audit"])(
		"rejects a %s report",
		async (change) => {
			const f = fixture();
			if (change === "missing") f.files.delete(f.reportPath);
			else if (change === "changed")
				f.files.set(f.reportPath, Buffer.from("changed"));
			else {
				if (change === "smoke") f.report.mode = "smoke";
				else if (change === "wrong-source")
					f.report.source.commit = "d".repeat(40);
				else Reflect.deleteProperty(f.report, "skillEvidence");
				f.save();
			}
			await expect(
				verifyRetainedSkillEvidence(f.input, f.read),
			).rejects.toThrow();
		},
	);
	it("verifies every artifact, including the full skills check log", async () => {
		const f = fixture();
		f.files.set(f.log, Buffer.from("changed log"));
		await expect(verifyRetainedSkillEvidence(f.input, f.read)).rejects.toThrow(
			"artifact digest mismatch",
		);
	});
	it.each(["static-command", "failed-command", "missing-check"])(
		"rejects %s deterministic evidence",
		async (change) => {
			const f = fixture();
			if (change === "static-command")
				f.report.commands[0].argv.push("--static");
			else if (change === "failed-command") f.report.commands[0].exitCode = 1;
			else {
				f.report.checks.splice(1, 1);
				f.receipt.checks.splice(1, 1);
			}
			f.save();
			await expect(
				verifyRetainedSkillEvidence(f.input, f.read),
			).rejects.toThrow();
		},
	);
	it("rejects historical bytes changed after the audited template run", async () => {
		const f = fixture();
		f.files.set(f.recordPaths[1], Buffer.from("changed historical trial"));
		await expect(verifyRetainedSkillEvidence(f.input, f.read)).rejects.toThrow(
			"Historical skill evidence changed",
		);
	});
	it.each(["skills", "references", "historical-audit"])(
		"rejects changed current %s",
		async (change) => {
			const f = fixture();
			if (change === "skills")
				f.input.audit.skillHashes.canonical = "d".repeat(64);
			else if (change === "references")
				Object.assign(f.input.audit.phase6ReferenceHashes, {
					changed: "d".repeat(64),
				});
			else f.input.audit.evidenceRecords[f.recordPaths[0]] = "d".repeat(64);
			await expect(
				verifyRetainedSkillEvidence(f.input, f.read),
			).rejects.toThrow("current applicability");
		},
	);
	it("requires the applicability review to match the committed bytes", async () => {
		const f = fixture();
		f.files.set(
			f.input.audit.review,
			Buffer.from("uncommitted applicability claim"),
		);
		await expect(verifyRetainedSkillEvidence(f.input, f.read)).rejects.toThrow(
			"committed bytes",
		);
	});
	it.each([
		"../receipt.json",
		"artifacts/../receipt.json",
		"/tmp/receipt.json",
	])("rejects receipt path %s", async (receiptPath) => {
		const f = fixture();
		await expect(
			verifyRetainedSkillEvidence({ ...f.input, receiptPath }, f.read),
		).rejects.toThrow();
	});
});
