import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.resolve(
	process.argv[2] ?? "artifacts/phase6-acceptance/evaluation/release",
);
await mkdir(output, { recursive: false });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const listed = execFileSync(
	"git",
	["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
	{ cwd: root },
)
	.toString()
	.split("\0")
	.filter(Boolean);
const files = [...new Set(listed)].filter(
	(file) =>
		!/^(evaluations\/|artifacts\/)/.test(file) &&
		!/(^|\/)(\.git|node_modules|artifacts|\.next|dist|coverage|storybook-static|\.turbo|\.ssh|\.aws|\.config|\.codex|\.docker|\.cache|test-results|playwright-report)(\/|$)/.test(
			file,
		) &&
		!/(^|\/)\.env(?!\.example$)|\.tsbuildinfo$|(^|\/)next-env\.d\.ts$/.test(
			file,
		) &&
		!/(^|\/)(credentials?|secrets?|auth)\.(json|ya?ml|toml)$|\.(pem|key|p12|pfx|crt)$/i.test(
			file,
		) &&
		!/(^|\/)(\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.DS_Store)$/.test(
			file,
		),
);
files.push("evaluations/phase4/heldout/reports.ts");
const sourceHashes = {};
for (const file of files.sort()) {
	let content;
	try {
		content = await readFile(path.join(root, file));
	} catch (error) {
		if (error.code === "ENOENT") continue;
		throw error;
	}
	sourceHashes[file] = digest(content);
	for (let run = 1; run <= 2; run++) {
		const target = path.join(output, `run-${run}`, "candidate", file);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content);
		if (run === 1) {
			const baseline = path.join(output, "initial-source", file);
			await mkdir(path.dirname(baseline), { recursive: true });
			await writeFile(baseline, content);
		}
	}
}
const customization =
	"Commercial support policy: retain customized workflows and existing tenant history.\n";
sourceHashes["CUSTOM-COMMERCIAL-NOTES.md"] = digest(customization);
await writeFile(
	path.join(output, "initial-source/CUSTOM-COMMERCIAL-NOTES.md"),
	customization,
);
for (let run = 1; run <= 2; run++) {
	const candidate = path.join(output, `run-${run}`, "candidate");
	await writeFile(
		path.join(candidate, "CUSTOM-COMMERCIAL-NOTES.md"),
		customization,
	);
	await cp(
		path.join(root, "evaluations/phase6/seeded-review"),
		path.join(candidate, "review-commercial"),
		{ recursive: true },
	);
	await cp(
		path.join(root, "evaluations/phase6/briefs"),
		path.join(candidate, "commercial-briefs"),
		{ recursive: true },
	);
}
await cp(
	path.join(root, "evaluations/phase6/heldout"),
	path.join(output, "controls"),
	{ recursive: true },
);
const protectedAdditional = {};
for (const folder of ["commercial-briefs", "review-commercial"]) {
	for (const file of await readdir(
		path.join(output, "run-1/candidate", folder),
	))
		protectedAdditional[`${folder}/${file}`] = digest(
			await readFile(path.join(output, "run-1/candidate", folder, file)),
		);
}
const controlHashes = {};
for (const file of await readdir(path.join(output, "controls")))
	controlHashes[file] = digest(
		await readFile(path.join(output, "controls", file)),
	);
const controlManifest = JSON.parse(
	await readFile(path.join(output, "controls/manifest.json"), "utf8"),
);
await mkdir(path.join(output, "controller"));
const controllerHashes = {};
for (const file of (
	await readdir(path.join(root, "evaluations/phase6"))
).filter((file) => /\.(mjs|ts|md)$/.test(file))) {
	const value = await readFile(path.join(root, "evaluations/phase6", file));
	await writeFile(path.join(output, "controller", file), value);
	controllerHashes[file] = digest(value);
}
const manifest = {
	version: 1,
	phase: 6,
	createdAt: new Date().toISOString(),
	templateCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root })
		.toString()
		.trim(),
	sourceHashes,
	protectedAdditional,
	controlHashes,
	controllerHashes,
	controlVersion: controlManifest.controlVersion,
	sourceSha256: digest(JSON.stringify(sourceHashes)),
	repeats: 2,
	configuration: {
		agent: "Codex CLI",
		version: execFileSync("codex", ["--version"]).toString().trim(),
		model: "host default; recorded exposed selection in actual transcript",
		sandbox: "workspace-write",
		noProviderCredentials: true,
	},
};
assert.ok(Object.keys(sourceHashes).length > 500);
await writeFile(
	path.join(output, "manifest.json"),
	`${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
	JSON.stringify({
		output,
		files: Object.keys(sourceHashes).length,
		sourceSha256: manifest.sourceSha256,
	}),
);
