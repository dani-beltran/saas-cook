import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [outputArg, repeatArg, label] = process.argv.slice(2);
const output = path.resolve(outputArg),
	repeat = Number(repeatArg);
assert.ok([1, 2].includes(repeat));
assert.match(label, /^[a-z0-9-]+$/);
const run = path.join(output, `run-${repeat}`),
	candidate = path.join(run, "candidate");
const manifest = JSON.parse(
	await readFile(path.join(output, "manifest.json"), "utf8"),
);
const digest = (value) => createHash("sha256").update(value).digest("hex");
for (const [file, hash] of Object.entries({
	...manifest.sourceHashes,
	...manifest.protectedAdditional,
}))
	assert.equal(
		digest(await readFile(path.join(candidate, file))),
		hash,
		`Protected source changed: ${file}`,
	);
const snapshot = path.join(run, `snapshot-${label}`);
await mkdir(snapshot, { recursive: false });
const hashes = {};
async function visit(folder) {
	for (const e of await readdir(folder, { withFileTypes: true })) {
		if (
			["node_modules", "artifacts", ".git", ".next", ".turbo", "dist"].includes(
				e.name,
			) ||
			/\.tsbuildinfo$|^next-env\.d\.ts$|^\.env/.test(e.name)
		)
			continue;
		const file = path.join(folder, e.name);
		if (e.isDirectory()) await visit(file);
		else if (e.isFile()) {
			const relative = path.relative(candidate, file);
			const content = await readFile(file);
			hashes[relative] = digest(content);
			if (!(relative in manifest.sourceHashes)) {
				const dest = path.join(snapshot, relative);
				await mkdir(path.dirname(dest), { recursive: true });
				await cp(file, dest);
			}
		}
	}
}
await visit(candidate);
const result = {
	capturedAt: new Date().toISOString(),
	label,
	sourceHashes: hashes,
	sourceSha256: digest(JSON.stringify(hashes)),
	added: Object.keys(hashes).filter((file) => !(file in manifest.sourceHashes)),
};
await writeFile(
	path.join(snapshot, "source.json"),
	`${JSON.stringify(result, null, 2)}\n`,
);
console.log(
	JSON.stringify({
		label,
		files: Object.keys(hashes).length,
		added: result.added,
		sourceSha256: result.sourceSha256,
	}),
);
