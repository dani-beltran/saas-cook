import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evaluateScan } from "./scan-policy.js";

const scope = process.argv[2] ?? "dependencies";
if (scope !== "dependencies" && scope !== "image") {
	throw new Error(
		"Usage: security-scan.ts dependencies | image [image-reference]",
	);
}
const target = scope === "image" ? process.argv[3] : ".";
if (!target) throw new Error("An image reference is required");
const directory =
	process.env.SECURITY_ARTIFACT_DIRECTORY ?? "artifacts/security";
if (
	!/^artifacts\/[a-zA-Z0-9._/-]+$/.test(directory) ||
	directory.split("/").includes("..")
)
	throw new Error("Security evidence must stay under artifacts/");
await mkdir(directory, { recursive: true });
const output = `${directory}/${scope}.json`;
const args = [
	scope === "image" ? "image" : "fs",
	"--scanners",
	"vuln",
	"--format",
	"json",
	"--output",
	output,
	"--exit-code",
	"0",
	"--timeout",
	"10m",
];
if (scope === "dependencies") {
	args.push("--include-dev-deps");
	args.push(
		"--skip-dirs",
		"node_modules,.git,artifacts,apps/web/.next,apps/backoffice/.next,spikes/phase0/api-next/.next",
	);
}
const run = spawnSync(process.env.TRIVY_BIN ?? "trivy", [...args, target], {
	stdio: "inherit",
	timeout: 11 * 60_000,
});
if (run.status !== 0)
	throw new Error(`Trivy scan failed: ${run.error?.message ?? run.status}`);
const blocked = evaluateScan(
	JSON.parse(await readFile(output, "utf8")),
	JSON.parse(await readFile("security/exceptions.json", "utf8")),
	scope,
);
await writeFile(
	`${directory}/${scope}-policy.json`,
	`${JSON.stringify(
		{
			scope,
			target,
			status: blocked.length ? "blocked" : "passed",
			blocked,
			checkedAt: new Date().toISOString(),
		},
		null,
		2,
	)}\n`,
);
if (blocked.length)
	throw new Error(
		`${blocked.length} high/critical vulnerabilities block ${scope}; see ${output}`,
	);
console.log(`${scope} vulnerability policy passed`);
