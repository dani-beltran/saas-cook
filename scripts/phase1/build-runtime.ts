import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
await mkdir(`${root}/dist`, { recursive: true });
await build({
	absWorkingDir: root,
	entryPoints: {
		worker: "apps/worker/src/index.ts",
		command: "scripts/phase1/command.ts",
		"platform-command": "scripts/phase6/command.ts",
		"billing-command": "scripts/phase5/command.ts",
		supervisor: "infra/docker/supervisor.ts",
	},
	outdir: "dist",
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	target: "node24",
	format: "esm",
	sourcemap: true,
	external: ["pg-native", "sharp"],
	banner: {
		js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
	},
});
