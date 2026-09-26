import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkContracts, checkRouteCapabilities } from "./contracts";
import { checkMigrations } from "./migrations";
import { checkSkills } from "./skills";

const args = process.argv.slice(2);
const staticOnly = args.includes("--static");
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "HEAD";
const root = process.cwd();
const attempt = `${Date.now()}-${randomUUID()}`;
const outputRoot = path.join(root, "artifacts/phase4/checks");
const output = path.join(outputRoot, attempt);
await mkdir(output, { recursive: true });
const report = {
	schemaVersion: 1,
	startedAt: new Date().toISOString(),
	base,
	mode: staticOnly ? "static" : "static-and-behavioral",
	artifactDirectory: `artifacts/phase4/checks/${attempt}`,
	failures: [] as string[],
	checks: [] as { name: string; status: "passed" | "failed"; log?: string }[],
};
async function check(name: string, work: () => Promise<string[]> | string[]) {
	try {
		const failures = await work();
		report.failures.push(...failures);
		report.checks.push({ name, status: failures.length ? "failed" : "passed" });
	} catch (error) {
		report.failures.push(
			`${name}: ${error instanceof Error ? error.message : "check failed"}`,
		);
		report.checks.push({ name, status: "failed" });
	}
}
if (
	args.some(
		(arg, index) =>
			arg !== "--static" &&
			arg !== "--base" &&
			!(baseIndex >= 0 && index === baseIndex + 1),
	) ||
	!base
) {
	report.failures.push(
		"Usage: bun run skills:check [--static] [--base <git-ref>]",
	);
} else {
	await check("skill-discovery-and-references", () => checkSkills(root));
	await check("migration-history", () => checkMigrations(root, base));
	await check("dto-input-allowlists", () => checkContracts());
	await check("endpoint-principal-declarations", async () =>
		checkRouteCapabilities(
			await readFile(path.join(root, "packages/api/src/router.ts"), "utf8"),
		),
	);
	if (!staticOnly && !report.failures.length) {
		for (const [name, project, selectors] of [
			[
				"guard-negative-controls",
				"unit",
				["scripts/phase4", "packages/api/src/resources.test.ts"],
			],
			[
				"real-service-boundaries",
				"integration",
				[
					"packages/testing/src/phase4.integration.test.ts",
					"packages/db",
					"packages/api",
					"packages/authz",
				],
			],
		] as const) {
			console.info(`Phase 4: running ${name}`);
			const result = spawnSync(
				process.execPath,
				[
					"node_modules/vitest/vitest.mjs",
					"run",
					"--project",
					project,
					...selectors,
				],
				{
					cwd: root,
					encoding: "utf8",
					maxBuffer: 32 * 1024 * 1024,
					env: {
						...process.env,
						VITEST_REPORT: path.join(output, `${name}.xml`),
					},
				},
			);
			const log = `${name}.log`;
			await writeFile(
				path.join(output, log),
				`${result.stdout ?? ""}${result.stderr ?? ""}`,
			);
			report.checks.push({
				name,
				status: result.status === 0 ? "passed" : "failed",
				log: `artifacts/phase4/checks/${attempt}/${log}`,
			});
			if (result.status !== 0)
				report.failures.push(
					`${name}: failed; see artifacts/phase4/checks/${attempt}/${log}`,
				);
		}
	}
}
await writeFile(
	path.join(output, "report.json"),
	`${JSON.stringify(report, null, 2)}\n`,
);
// The latest pointer is convenient for CI; immutable attempt directories retain
// earlier failures and their logs when a later run repairs the problem.
await writeFile(
	path.join(outputRoot, "report.json"),
	`${JSON.stringify(report, null, 2)}\n`,
);
for (const item of report.checks) console.info(`${item.status}: ${item.name}`);
for (const failure of report.failures) console.error(failure);
console.info(`Evidence: artifacts/phase4/checks/${attempt}/report.json`);
process.exitCode = report.failures.length ? 1 : 0;
