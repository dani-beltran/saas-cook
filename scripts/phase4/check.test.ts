import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { checkContracts, checkRouteCapabilities } from "./contracts";
import { checkMigrations } from "./migrations";

const cleanup: string[] = [];
afterEach(async () => {
	for (const directory of cleanup.splice(0))
		await rm(directory, { recursive: true, force: true });
});

describe("Phase 4 executable contract and route guards", () => {
	it("accepts current application contracts and explicit endpoint capabilities", async () => {
		expect(checkContracts()).toEqual([]);
		expect(
			checkRouteCapabilities(
				await readFile("packages/api/src/router.ts", "utf8"),
			),
		).toEqual([]);
	});
	it("catches seeded DTO leakage and client-writable server fields", () => {
		const tree = {
			widgets: {
				create: {
					"~orpc": {
						inputSchema: z.strictObject({
							name: z.string(),
							actorId: z.string(),
							id: z.uuid(),
						}),
						outputSchema: z.object({ id: z.uuid(), secretHash: z.string() }),
					},
				},
			},
		};
		expect(checkContracts(tree)).toEqual([
			"widgets.create.input.actorId: internal/server-owned field exposed",
			"widgets.create.input.id: create cannot assign server identity/version",
			"widgets.create.output.secretHash: internal/server-owned field exposed",
		]);
	});
	it("catches nested unknown-field forwarding and undeclared endpoint capabilities", async () => {
		expect(
			checkContracts({
				"~orpc": {
					inputSchema: z.object({ nested: z.looseObject({}) }),
					outputSchema: z.looseObject({ id: z.uuid() }),
				},
			}),
		).toHaveLength(3);
		const source = await readFile("packages/api/src/router.ts", "utf8");
		expect(
			checkRouteCapabilities(
				source.replace(
					"{ mutate: false, serviceAccounts: true }",
					"{ mutate: false }",
				),
			),
		).toContain("projects.list: explicit serviceAccounts capability required");
		expect(
			checkRouteCapabilities(
				source.replace("resourceOperation(", "unreviewedOperation("),
			),
		).toContain("projects.list: missing permission boundary");
	});
	it("inspects container schemas and rejects uninspectable fallbacks and transforms", () => {
		const inspectOutput = (outputSchema: z.ZodType) =>
			checkContracts({
				"~orpc": { inputSchema: z.strictObject({}), outputSchema },
			});
		const exposed = z.object({ secretHash: z.string() });
		for (const schema of [
			exposed.readonly(),
			z.intersection(z.object({ id: z.string() }), exposed),
			z.tuple([exposed]),
			z.tuple([]).rest(exposed),
		])
			expect(
				inspectOutput(schema).some((failure) => failure.includes("secretHash")),
			).toBe(true);
		for (const schema of [
			exposed.catch({ secretHash: "fallback" }),
			exposed.default({ secretHash: "default" }),
			z.lazy(() => exposed),
			z.custom(),
		])
			expect(
				inspectOutput(schema).some((failure) =>
					failure.includes("unsupported"),
				),
			).toBe(true);
		expect(
			inspectOutput(
				z.object({ id: z.string() }).transform((row) => ({
					...row,
					secretHash: "unexpected",
				})),
			),
		).toContain(".output: transform requires a bounded output schema");
		expect(
			inspectOutput(z.string().transform((value) => value.length)),
		).toContain(".output: transform requires a bounded output schema");
		expect(
			inspectOutput(
				z
					.string()
					.transform((value) => value.length)
					.pipe(z.number()),
			),
		).toEqual([]);
		expect(
			inspectOutput(
				z
					.string()
					.transform((value) => ({ secretHash: value }))
					.pipe(exposed),
			),
		).toContain(".output.secretHash: internal/server-owned field exposed");
	});
	it("rejects capability overrides that would bypass a static declaration", () => {
		for (const properties of [
			"mutate: false, serviceAccounts: false, ...overrides",
			'mutate: false, serviceAccounts: false, ["serviceAccounts"]: true',
			"mutate: false, serviceAccounts: false, serviceAccounts: true",
			"mutate: false, serviceAccounts: false, unknown: true",
			"mutate: false, serviceAccounts",
		]) {
			expect(
				checkRouteCapabilities(
					`api.router({ widgets: { list: api.widgets.list.handler(({input,context}) => resourceOperation(context,input.organizationId,{${properties}},work)) } })`,
				),
			).not.toEqual([]);
		}
	});
	it("requires newly registered endpoints to declare a shared permission boundary", () => {
		expect(
			checkRouteCapabilities(
				"api.router({ widgets: { list: api.widgets.list.handler(({input}) => loadAll(input)) } })",
			),
		).toEqual(["widgets.list: missing permission boundary"]);
	});
});

describe("Phase 4 migration history guard", () => {
	it("accepts only the exact approved database rename from its original history", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "phase4-rename-"));
		cleanup.push(root);
		const directory = "packages/db/migrations";
		await cp(directory, path.join(root, directory), { recursive: true });
		const transitions = JSON.parse(
			await readFile("scripts/phase4/saas-cook-history-reset.json", "utf8"),
		);
		for (const file of Object.keys(transitions)) {
			const target = path.join(root, directory, file);
			await writeFile(
				target,
				(await readFile(target, "utf8")).replaceAll("saas_cook", "common_saas"),
			);
		}
		const git = (args: string[]) =>
			execFileSync("git", args, { cwd: root, stdio: "ignore" });
		git(["init"]);
		git(["add", "."]);
		git([
			"-c",
			"user.name=Phase 4 fixture",
			"-c",
			"user.email=fixture@example.test",
			"commit",
			"-m",
			"test: capture pre-rename migration history",
		]);
		await cp(directory, path.join(root, directory), { recursive: true });
		expect(await checkMigrations(root)).toEqual([]);
		for (const file of ["0006_resources.sql", "meta/0006_snapshot.json"]) {
			const target = path.join(root, directory, file);
			const content = await readFile(target, "utf8");
			await writeFile(target, `${content}\n`);
			expect(await checkMigrations(root)).toContain(
				`${file}: applied migration history changed since HEAD`,
			);
			await writeFile(target, content);
		}
		// A lookalike rename from any other baseline must still be rejected.
		const file = "0006_resources.sql";
		const original = await readFile(path.join(directory, file), "utf8");
		await writeFile(
			path.join(root, directory, file),
			`${original.replaceAll("saas_cook", "common_saas")}\n`,
		);
		git(["add", "."]);
		git([
			"-c",
			"user.name=Phase 4 fixture",
			"-c",
			"user.email=fixture@example.test",
			"commit",
			"-m",
			"test: capture unapproved history",
		]);
		await writeFile(path.join(root, directory, file), `${original}\n`);
		expect(await checkMigrations(root)).toContain(
			`${file}: applied migration history changed since HEAD`,
		);
	});
	it("accepts the reviewed chain and rejects a changed applied SQL migration", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "phase4-history-"));
		cleanup.push(root);
		await cp(
			"packages/db/migrations",
			path.join(root, "packages/db/migrations"),
			{ recursive: true },
		);
		const git = (args: string[]) =>
			execFileSync("git", args, { cwd: root, stdio: "ignore" });
		git(["init"]);
		git(["add", "."]);
		git([
			"-c",
			"user.name=Phase 4 fixture",
			"-c",
			"user.email=fixture@example.test",
			"commit",
			"-m",
			"test: capture synthetic migration history",
		]);
		expect(await checkMigrations(root)).toEqual([]);
		await writeFile(
			path.join(root, "packages/db/migrations/0006_resources.sql"),
			"-- seeded historical rewrite\n",
		);
		expect(await checkMigrations(root)).toContain(
			"0006_resources.sql: applied migration history changed since HEAD",
		);
		await writeFile(
			path.join(root, "packages/db/migrations/9999_unreviewed.sql"),
			"SELECT 1;\n",
		);
		expect(await checkMigrations(root)).toContain(
			"9999_unreviewed.sql: unjournaled migration",
		);
	});
});
