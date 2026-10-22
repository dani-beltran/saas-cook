import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectToolchainPackages } from "../phase0/toolchain-packages";

const directories: string[] = [];
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "phase0-toolchain-"));
	directories.push(root);
	await mkdir(join(root, "node_modules"));
	await manifest(root, {
		workspaces: ["packages/*"],
		devDependencies: { external: "1.2.3", local: "workspace:*" },
	});
	await manifest(join(root, "node_modules/external"), {
		name: "external",
		version: "1.2.3",
	});
	await manifest(join(root, "packages/local"), {
		name: "local",
		private: true,
	});
	await symlink(
		join(root, "packages/local"),
		join(root, "node_modules/local"),
		"dir",
	);
	return root;
}
async function manifest(directory: string, value: object) {
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "package.json"), JSON.stringify(value));
}
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});
it("records exact external pins and declared unversioned workspace links", async () => {
	const root = await fixture();
	expect(await inspectToolchainPackages(root)).toEqual([
		{ name: "external", version: "1.2.3", kind: "external" },
		{
			name: "local",
			version: null,
			kind: "workspace",
			source: "packages/local",
		},
	]);
});
it("records a declared workspace version", async () => {
	const root = await fixture();
	await manifest(join(root, "packages/local"), {
		name: "local",
		version: "2.0.0",
	});
	expect((await inspectToolchainPackages(root))[1].version).toBe("2.0.0");
});
it("rejects an external installed-version mismatch", async () => {
	const root = await fixture();
	await manifest(join(root, "node_modules/external"), {
		name: "external",
		version: "1.2.4",
	});
	await expect(inspectToolchainPackages(root)).rejects.toThrow(
		"exact manifest pin",
	);
});
it("rejects a floating external pin", async () => {
	const root = await fixture();
	await manifest(root, {
		workspaces: ["packages/*"],
		devDependencies: { external: "^1.2.3" },
	});
	await expect(inspectToolchainPackages(root)).rejects.toThrow(
		"exact external manifest pin",
	);
});
it("rejects a substituted package identity", async () => {
	const root = await fixture();
	await manifest(join(root, "node_modules/external"), {
		name: "other",
		version: "1.2.3",
	});
	await expect(inspectToolchainPackages(root)).rejects.toThrow(
		"package identity",
	);
});
it("rejects an undeclared workspace", async () => {
	const root = await fixture();
	await manifest(root, {
		workspaces: [],
		devDependencies: { local: "workspace:*" },
	});
	await expect(inspectToolchainPackages(root)).rejects.toThrow(
		"one declared workspace",
	);
});
it("rejects a duplicate workspace identity", async () => {
	const root = await fixture();
	await manifest(join(root, "packages/duplicate"), { name: "local" });
	await expect(inspectToolchainPackages(root)).rejects.toThrow(
		"one declared workspace",
	);
});
it("rejects a copied package in place of a link", async () => {
	const root = await fixture();
	await rm(join(root, "node_modules/local"));
	await manifest(join(root, "node_modules/local"), { name: "local" });
	await expect(inspectToolchainPackages(root)).rejects.toThrow(
		"workspace link",
	);
});
it("rejects a link to an undeclared same-name source", async () => {
	const root = await fixture();
	await manifest(join(root, "outside"), { name: "local" });
	await rm(join(root, "node_modules/local"));
	await symlink(join(root, "outside"), join(root, "node_modules/local"), "dir");
	await expect(inspectToolchainPackages(root)).rejects.toThrow(
		"declared workspace",
	);
});
