import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const args = process.argv.slice(2);
// Each spec owns a fresh disposable installation. Identity throttles deliberately
// aggregate requests from the same source; unrelated test users and the visual
// matrix must not spend one another's authentication budget. Keep limits enabled.
// Explicit Playwright filters and options retain the native CLI semantics.
const specs =
	args.length > 0
		? [null]
		: readdirSync("tests/e2e")
				.filter((name) => name.endsWith(".spec.ts"))
				.sort();

let failed = false;
for (const spec of specs) {
	const run = spawnSync(
		process.execPath,
		[
			"node_modules/@playwright/test/cli.js",
			"test",
			...(spec ? [`tests/e2e/${spec}`] : []),
			...args,
		],
		{
			stdio: "inherit",
			env: {
				...process.env,
				...(spec ? { E2E_REPORT_GROUP: spec.replace(".spec.ts", "") } : {}),
			},
		},
	);
	if (run.error) throw run.error;
	if (run.status !== 0) failed = true;
	if (run.signal) break;
}
process.exitCode = failed ? 1 : 0;
