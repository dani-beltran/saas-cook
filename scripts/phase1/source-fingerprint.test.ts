import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { sourceFingerprint } from "./source-fingerprint";

it("binds new hardening, skill and browser inputs while excluding self-referential evidence", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "phase8-fingerprint-"));
	try {
		await promisify(execFile)("git", ["init", root]);
		let previous = await sourceFingerprint(root);
		for (const name of [
			"scripts/phase8/check.ts",
			".agents/skills/saas-bootstrap/SKILL.md",
			"evaluations/phase6/check.ts",
			"playwright.theme.config.ts",
		]) {
			await mkdir(path.dirname(path.join(root, name)), { recursive: true });
			await writeFile(path.join(root, name), "binding input");
			const next = await sourceFingerprint(root);
			expect(next).not.toBe(previous);
			previous = next;
		}
		await mkdir(path.join(root, "docs/phase8"), { recursive: true });
		await writeFile(
			path.join(root, "docs/phase8/acceptance.md"),
			"Evidence summary",
		);
		expect(await sourceFingerprint(root)).toBe(previous);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
