import { describe, expect, it } from "vitest";
import {
	assertCompatiblePair,
	compatibilityManifest,
} from "./compatibility-contract";

describe("initial release compatibility", () => {
	it("binds locked dependencies, package metadata and shared TSX runtime code", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "phase8-compatibility-"));
		try {
			for (const name of [
				"db",
				"authz",
				"auth",
				"config",
				"api-contracts",
				"api",
				"email",
				"observability",
			]) {
				await mkdir(path.join(root, "packages", name), { recursive: true });
				await cp(
					`packages/${name}/src`,
					path.join(root, "packages", name, "src"),
					{ recursive: true },
				);
				await cp(
					`packages/${name}/package.json`,
					path.join(root, "packages", name, "package.json"),
				);
			}
			await cp(
				"packages/db/migrations",
				path.join(root, "packages/db/migrations"),
				{ recursive: true },
			);
			for (const name of ["bun.lock", "package.json"])
				await cp(name, path.join(root, name));
			const baseline = await compatibilityManifest("customer");
			expect(await compatibilityManifest("customer", root)).toEqual(baseline);
			for (const name of [
				"bun.lock",
				"packages/db/package.json",
				"packages/email/src/index.tsx",
			]) {
				const file = path.join(root, name);
				const original = await readFile(file, "utf8");
				const changed =
					name === "bun.lock"
						? original.replace('"stripe": "23.0.0"', '"stripe": "23.0.1"')
						: `${original}\n`;
				expect(changed).not.toEqual(original);
				await writeFile(file, changed);
				const customer = await compatibilityManifest("customer", root);
				expect(customer.sharedServiceSha256).not.toBe(
					baseline.sharedServiceSha256,
				);
				await expect(
					assertCompatiblePair(
						customer,
						await compatibilityManifest("backoffice", root),
					),
				).rejects.toThrow("Unsupported image contract");
				await writeFile(file, original);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("supports only the declared exact current customer and operator contracts", async () => {
		const customer = await compatibilityManifest("customer");
		const backoffice = await compatibilityManifest("backoffice");
		await expect(
			assertCompatiblePair(customer, backoffice),
		).resolves.toBeUndefined();
		for (const change of [
			{ version: 2 },
			{ target: "customer" },
			{ operatorModel: "0".repeat(64) },
			{ sharedServiceSha256: "0".repeat(64) },
			{ tenantModel: "0".repeat(64) },
			{ controlContractSha256: "0".repeat(64) },
			{
				applicationSchema: {
					...backoffice.applicationSchema,
					max: backoffice.applicationSchema.max + 1,
				},
			},
			{ protocols: { ...backoffice.protocols, deletionJournal: 2 } },
			{ unknown: "future" },
		])
			await expect(
				assertCompatiblePair(customer, { ...backoffice, ...change }),
			).rejects.toThrow();
		await expect(assertCompatiblePair(backoffice, customer)).rejects.toThrow();
	});
	it("rejects matching unknown contracts on both sides of the pair", async () => {
		const customer = await compatibilityManifest("customer");
		const backoffice = await compatibilityManifest("backoffice");
		for (const change of [
			{
				applicationSchema: {
					...customer.applicationSchema,
					min: 999,
					max: 999,
				},
			},
			{ tenantModel: "0".repeat(64) },
			{ controlContractSha256: "0".repeat(64) },
			{ sharedServiceSha256: "0".repeat(64) },
			{ protocols: { ...customer.protocols, stripeApi: "unknown" } },
		])
			await expect(
				assertCompatiblePair(
					{ ...customer, ...change },
					{ ...backoffice, ...change },
				),
			).rejects.toThrow("Unsupported image contract");
	});
});

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
