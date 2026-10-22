import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { writeCompatibilityManifest } from "../phase8/compatibility-contract";

await mkdir("dist/backoffice", { recursive: true });
await writeCompatibilityManifest(
	"dist/backoffice/compatibility.json",
	"backoffice",
);
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
