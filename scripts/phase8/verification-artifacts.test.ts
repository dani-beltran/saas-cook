import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
	collectVerificationArtifacts,
	playwrightEvidencePaths,
	verificationEnvironment,
} from "./verification-artifacts";

const fixtures: string[] = [];
async function fixture() {
	const directory = `artifacts/phase8/report-fixtures/${randomUUID()}`;
	await mkdir(directory, { recursive: true });
	fixtures.push(directory);
	return directory;
}
afterEach(async () => {
	await Promise.all(
		fixtures
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("attempt-owned structured verification evidence", () => {
	it("preserves ordinary defaults and spec labels required by data-job workers", () => {
		expect(playwrightEvidencePaths("browser", {})).toEqual({
			results: "artifacts/playwright-results",
			html: "artifacts/playwright",
			json: "artifacts/playwright-results/results.json",
		});
		expect(playwrightEvidencePaths("theme", {})).toEqual({
			results: "artifacts/theme/results",
			html: "artifacts/theme/report",
			json: "artifacts/theme/results.json",
		});
		const env = verificationEnvironment("artifacts/phase8/checks/browser-a/0", {
			NODE_ENV: "test",
			E2E_REPORT_GROUP: "data-jobs",
			OPENFGA_API_URL: "http://localhost:18081",
			PLAYWRIGHT_JSON_OUTPUT_FILE: "outside.json",
			PLAYWRIGHT_HTML_REPORT: "old-report",
		});
		expect(env.E2E_REPORT_GROUP).toBe("data-jobs");
		expect(env.OPENFGA_API_URL).toBe("http://localhost:18081");
		expect(env.PLAYWRIGHT_JSON_OUTPUT_FILE).toBeUndefined();
		expect(env.PLAYWRIGHT_HTML_REPORT).toBeUndefined();
		expect(playwrightEvidencePaths("browser", env).results).toBe(
			"artifacts/phase8/checks/browser-a/0/browser/data-jobs/results",
		);
		expect(env.VITEST_REPORT).toBe(
			"artifacts/phase8/checks/browser-a/0/vitest.xml",
		);
		expect(env.SECURITY_ARTIFACT_DIRECTORY).toBe(
			"artifacts/phase8/checks/browser-a/0/security",
		);
	});
	it.each(["../outside", "/tmp/outside", "", "a/b", "..", "data jobs"])(
		"rejects unsafe spec group %j before cleanup",
		(group) => {
			expect(() =>
				playwrightEvidencePaths("browser", { E2E_REPORT_GROUP: group }),
			).toThrow("safe spec label");
		},
	);
	it.each([
		"/tmp/outside",
		"artifacts/phase8/../other",
		"artifacts/phase8//empty",
		"artifacts/phase8/./current",
		"artifacts/other",
	])("rejects unsafe report root %j", (destination) => {
		expect(() =>
			verificationEnvironment(destination, { NODE_ENV: "test" }),
		).toThrow();
	});
	it("keeps each spec and attempt separate and retains failure JSON, XML, axe and trace bytes", async () => {
		const first = await fixture(),
			second = await fixture();
		const firstPaths = playwrightEvidencePaths("browser", {
			PHASE8_REPORT_DIRECTORY: first,
			E2E_REPORT_GROUP: "accessibility",
		});
		const secondPaths = playwrightEvidencePaths("browser", {
			PHASE8_REPORT_DIRECTORY: second,
			E2E_REPORT_GROUP: "accessibility",
		});
		expect(firstPaths.results).not.toBe(secondPaths.results);
		expect(
			playwrightEvidencePaths("browser", {
				PHASE8_REPORT_DIRECTORY: first,
				E2E_REPORT_GROUP: "identity",
			}).results,
		).not.toBe(firstPaths.results);
		await mkdir(`${firstPaths.results}/attachments`, { recursive: true });
		await mkdir(`${first}/security`, { recursive: true });
		const contents = new Map([
			[`${first}/command.log`, "failed: accessibility"],
			[`${first}/vitest.xml`, '<testsuites failures="1"/>'],
			[firstPaths.json, '{"stats":{"unexpected":1}}'],
			[
				`${firstPaths.results}/attachments/axe.json`,
				'{"violations":[{"id":"label"}]}',
			],
			[`${firstPaths.results}/trace.zip`, "synthetic trace bytes"],
			[
				`${first}/security/dependencies.json`,
				'{"Results":[{"Vulnerabilities":[]}]}',
			],
		]);
		for (const [file, value] of contents) await writeFile(file, value);
		const collected = await collectVerificationArtifacts(
			"test:e2e",
			first,
			Date.now(),
		);
		expect(collected).toEqual([...contents.keys()].sort());
		await mkdir(secondPaths.results, { recursive: true });
		await writeFile(secondPaths.json, '{"stats":{"unexpected":0}}');
		for (const [file, value] of contents)
			expect(await readFile(file, "utf8")).toBe(value);
	});
	it("refuses source trees and symlinks while retaining the original diagnostics", async () => {
		const directory = await fixture();
		await writeFile(`${directory}/command.log`, "failed diagnostic");
		await symlink("command.log", `${directory}/alias.log`);
		await expect(
			collectVerificationArtifacts("test:unit", directory, Date.now()),
		).rejects.toThrow("symlinks");
		await rm(`${directory}/alias.log`);
		await mkdir(`${directory}/candidate`);
		await expect(
			collectVerificationArtifacts("test:unit", directory, Date.now()),
		).rejects.toThrow("Build/dependency trees");
		expect(await readFile(`${directory}/command.log`, "utf8")).toBe(
			"failed diagnostic",
		);
	});
});
