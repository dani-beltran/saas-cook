import { readFile } from "node:fs/promises";
import {
	assertCompatiblePair,
	compatibilityManifest,
	writeCompatibilityManifest,
} from "./compatibility-contract";
import { evidenceSource, writeEvidence } from "./evidence";

const startedAt = new Date().toISOString();
const source = await evidenceSource();
const files = process.argv.slice(2);
if (files.length !== 0 && files.length !== 2)
	throw new Error(
		"Usage: phase8:compatibility [customer-manifest backoffice-manifest]",
	);
const checks: Array<{ name: string; passed: boolean }> = [];
try {
	const customer = files.length
		? JSON.parse(await readFile(files[0], "utf8"))
		: await compatibilityManifest("customer");
	const backoffice = files.length
		? JSON.parse(await readFile(files[1], "utf8"))
		: await compatibilityManifest("backoffice");
	await assertCompatiblePair(customer, backoffice);
	checks.push({ name: "exact-contract-pair", passed: true });
	if (!files.length) {
		await writeCompatibilityManifest(
			"artifacts/phase8/customer-compatibility.json",
			"customer",
		);
		await writeCompatibilityManifest(
			"artifacts/phase8/backoffice-compatibility.json",
			"backoffice",
		);
	}
	console.log(
		await writeEvidence({
			gate: "compatibility-contract",
			preset: "commercial-local",
			startedAt,
			source,
			outcome: "passed",
			checks,
			limitations: [
				"Contract comparison alone does not establish deployed version-pair behavior",
				"No previous released product baseline exists",
			],
		}),
	);
} catch {
	checks.push({ name: "verification-completed", passed: false });
	console.error(
		await writeEvidence({
			gate: "compatibility-contract",
			preset: "commercial-local",
			startedAt,
			source,
			outcome: "failed",
			checks,
			limitations: ["Use matching contracts or reviewed forward repair"],
		}),
	);
	process.exitCode = 1;
}
