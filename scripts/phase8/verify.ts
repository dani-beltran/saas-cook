import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { evidenceSource, writeEvidence } from "./evidence";
import {
	collectVerificationArtifacts,
	verificationEnvironment,
} from "./verification-artifacts";

// Only repository-owned checks can be selected; this is not an arbitrary shell runner.
const commands: Record<string, string[][]> = {
	source: [["check"], ["typecheck"], ["knip"]],
	unit: [["test:unit"]],
	integration: [["test:integration"]],
	browser: [["test:e2e"]],
	storybook: [["storybook:build"], ["test:theme", "--workers=4"]],
	build: [["build:customer"], ["build:backoffice"]],
	"security-dependencies": [["security:scan", "dependencies"]],
	accessibility: [
		["test:e2e", "tests/e2e/accessibility.spec.ts", "--workers=2"],
		["test:theme", "--workers=4"],
	],
	compatibility: [
		["phase8:compatibility"],
		["test:integration", "packages/db/src/migrations.integration.test.ts"],
	],
	"skills-contracts": [["skills:check"]],
};
const gate = process.argv[2];
if (process.argv.length !== 3 || !Object.hasOwn(commands, gate ?? ""))
	throw new Error(`Usage: phase8:verify ${Object.keys(commands).join("|")}`);
const source = await evidenceSource();
const startedAt = new Date().toISOString();
const checks: Array<{ name: string; passed: boolean }> = [];
const artifacts: string[] = [];
const directory = `artifacts/phase8/checks/${gate}-${randomUUID()}`;
await mkdir(directory, { recursive: true });
try {
	for (const [index, args] of commands[gate].entries()) {
		const commandDirectory = `${directory}/${index}`;
		await mkdir(commandDirectory, { recursive: true });
		const file = `${commandDirectory}/command.log`;
		const commandStartedAt = Date.now();
		const output = createWriteStream(file, { flags: "wx" });
		const passed = await new Promise<boolean>((resolve) => {
			const child = spawn("bun", ["run", ...args], {
				env: verificationEnvironment(commandDirectory, process.env),
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 40 * 60_000,
			});
			child.stdout.pipe(output, { end: false });
			child.stderr.pipe(output, { end: false });
			child.once("error", () => resolve(false));
			child.once("close", (code) => resolve(code === 0));
		});
		output.end();
		await finished(output);
		artifacts.push(file);
		artifacts.push(
			...(
				await collectVerificationArtifacts(
					args[0],
					commandDirectory,
					commandStartedAt,
				)
			).filter((artifact) => artifact !== file),
		);
		checks.push({ name: args[0], passed });
		console.log(`${passed ? "passed" : "failed"}: ${args.join(" ")} - ${file}`);
		if (!passed) throw new Error("Required check failed");
	}
	const after = await evidenceSource();
	checks.push({
		name: "stable-source",
		passed:
			after.commit === source.commit &&
			after.fingerprint === source.fingerprint &&
			after.dirty === source.dirty,
	});
	if (!checks.at(-1)?.passed)
		throw new Error("Source changed during verification");
	console.log(
		await writeEvidence(
			{
				gate,
				preset: "commercial-local",
				startedAt,
				source,
				outcome: "passed",
				checks,
				limitations: [
					"Application checks do not replace independent skill authoring evidence",
				],
			},
			artifacts,
		),
	);
} catch {
	checks.push({ name: "verification-completed", passed: false });
	console.error(
		await writeEvidence(
			{
				gate,
				preset: "commercial-local",
				startedAt,
				source,
				outcome: "failed",
				checks,
				limitations: ["See retained attempt logs"],
			},
			artifacts,
		),
	);
	process.exitCode = 1;
}
