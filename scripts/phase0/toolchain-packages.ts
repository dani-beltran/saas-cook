import assert from "node:assert/strict";
import { glob, lstat, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

/**
 * Inspect root development dependencies without treating local workspace links as
 * published version pins. External packages must match exact versions; workspace
 * packages must link to their unique declared source with the same name/version.
 * Returns provenance records and throws on missing, substituted or unpinned packages.
 * @param rootDirectory Repository root containing package.json and node_modules.
 */
export async function inspectToolchainPackages(rootDirectory: string) {
	rootDirectory = await realpath(rootDirectory);
	const root = JSON.parse(
		await readFile(resolve(rootDirectory, "package.json"), "utf8"),
	) as {
		devDependencies: Record<string, string>;
		workspaces: string[];
	};
	const workspaces = new Map<string, string[]>();
	for (const pattern of root.workspaces) {
		for await (const manifest of glob(`${pattern}/package.json`, {
			cwd: rootDirectory,
		})) {
			const source = JSON.parse(
				await readFile(resolve(rootDirectory, manifest), "utf8"),
			);
			const paths = workspaces.get(source.name) ?? [];
			const directory = await realpath(
				dirname(resolve(rootDirectory, manifest)),
			);
			if (!paths.includes(directory)) paths.push(directory);
			workspaces.set(source.name, paths);
		}
	}
	const packages = [];
	for (const [name, pin] of Object.entries(root.devDependencies)) {
		const installed = resolve(rootDirectory, "node_modules", name);
		const pkg = JSON.parse(
			await readFile(resolve(installed, "package.json"), "utf8"),
		);
		assert.equal(pkg.name, name, `${name} must retain its package identity`);
		if (pin.startsWith("workspace:")) {
			assert.equal(
				pin,
				"workspace:*",
				`${name} must use the supported workspace protocol`,
			);
			const sources = workspaces.get(name) ?? [];
			assert.equal(
				sources.length,
				1,
				`${name} must have one declared workspace source`,
			);
			assert.ok(
				(await lstat(installed)).isSymbolicLink(),
				`${name} must be a workspace link`,
			);
			assert.equal(
				await realpath(installed),
				sources[0],
				`${name} must link to its declared workspace`,
			);
			const source = JSON.parse(
				await readFile(resolve(sources[0], "package.json"), "utf8"),
			);
			assert.ok(
				source.version === undefined ||
					(typeof source.version === "string" && source.version.length > 0),
				`${name} must have an absent or nonempty workspace version`,
			);
			assert.equal(
				pkg.version,
				source.version,
				`${name} must match its workspace version`,
			);
			packages.push({
				name,
				version: pkg.version ?? null,
				license: pkg.license,
				kind: "workspace",
				source: relative(rootDirectory, sources[0]),
			});
		} else {
			assert.match(
				pin,
				/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
				`${name} must have an exact external manifest pin`,
			);
			assert.equal(
				pkg.version,
				pin,
				`${name} must match its exact manifest pin`,
			);
			packages.push({
				name,
				version: pkg.version,
				license: pkg.license,
				kind: "external",
			});
		}
	}
	return packages;
}
