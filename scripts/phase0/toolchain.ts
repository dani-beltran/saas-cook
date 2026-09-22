import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const root = JSON.parse(await readFile("package.json", "utf8"));
const packages = [];
for (const [name, pin] of Object.entries(root.devDependencies)) {
	const pkg = JSON.parse(
		await readFile(resolve("node_modules", name, "package.json"), "utf8"),
	);
	assert.equal(pkg.version, pin, `${name} must match its exact manifest pin`);
	packages.push({ name, version: pkg.version, license: pkg.license });
}
const commands = [];
for (const name of [
	"next",
	"@biomejs/biome",
	"@commitlint/cli",
	"lefthook",
	"knip",
	"shadcn",
	"drizzle-kit",
]) {
	const directory = resolve("node_modules", name);
	const pkg = JSON.parse(
		await readFile(resolve(directory, "package.json"), "utf8"),
	);
	const bin =
		typeof pkg.bin === "string"
			? pkg.bin
			: (Object.values(pkg.bin)[0] as string);
	const result = spawnSync(
		process.execPath,
		[resolve(directory, bin), "--version"],
		{ encoding: "utf8", timeout: 15000 },
	);
	assert.equal(result.status, 0, `${name}: ${result.stderr}`);
	commands.push({
		name,
		output: result.stdout.trim(),
		exitCode: result.status,
	});
}
const bun = spawnSync("bun", ["--version"], {
	encoding: "utf8",
	timeout: 15000,
});
assert.equal(bun.status, 0, "Pinned Bun must be in PATH");
assert.equal(bun.stdout.trim(), "1.4.2");
const result = {
	status: "passed",
	checkedAt: new Date().toISOString(),
	node: process.version,
	bun: bun.stdout.trim(),
	platform: process.platform,
	arch: process.arch,
	packages,
	commands,
};
await mkdir("artifacts/phase0", { recursive: true });
await writeFile(
	"artifacts/phase0/toolchain.json",
	JSON.stringify(result, null, 2) + "\n",
);
console.log(
	`Verified ${packages.length} exact dependency pins, Bun and ${commands.length} CLI entry points on ${process.version}`,
);
