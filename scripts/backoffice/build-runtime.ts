import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist/backoffice", { recursive: true });
await build({
	entryPoints: ["infra/docker/backoffice-start.ts"],
	outfile: "dist/backoffice/start.cjs",
	bundle: true,
	platform: "node",
	target: "node24",
	format: "cjs",
	external: ["pg-native"],
	logLevel: "warning",
});
