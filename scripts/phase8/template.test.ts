import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { publicConfig } from "../../packages/config/src/client";
import {
	adoptTemplateFixture,
	templatePresetEnvironment,
	validateTemplatePreset,
} from "./template-workflows";

describe("declared template presets use actual runtime validation", () => {
	it.each(["foundation", "commercial-local", "commercial-provider"])(
		"validates %s without contacting a provider",
		(name) => {
			const env = templatePresetEnvironment(name);
			const runtime = validateTemplatePreset(name, env);
			expect(runtime.FILES_ENABLED).toBe(
				name === "foundation" ? "false" : "true",
			);
			expect(runtime.BILLING_ENABLED).toBe(
				name === "commercial-provider" ? "true" : "false",
			);
			for (const locale of ["en", "es"])
				expect(publicConfig({ ...env, DEFAULT_LOCALE: locale })).toEqual({
					appName: "Northstar Work",
					defaultLocale: locale,
				});
		},
	);
	it("rejects unknown presets, undeclared flag changes and invalid booleans", () => {
		expect(() => validateTemplatePreset("enterprise", {})).toThrow("Unknown");
		expect(() => templatePresetEnvironment("enterprise")).toThrow("Unknown");
		expect(() =>
			validateTemplatePreset(
				"foundation",
				templatePresetEnvironment("commercial-local"),
			),
		).toThrow("do not match");
		expect(() =>
			validateTemplatePreset("foundation", {
				...templatePresetEnvironment("foundation"),
				FILES_ENABLED: "sometimes",
			}),
		).toThrow();
	});
	it.each([
		["commercial-local", "FILES_S3_UPLOAD_SECRET"],
		["commercial-local", "FILES_S3_FINALIZER_KEY"],
		["commercial-local", "LIFECYCLE_DATABASE_URL"],
		["commercial-local", "JOURNAL_DATABASE_URL"],
		["commercial-provider", "STRIPE_SECRET_KEY"],
		["commercial-provider", "POSTHOG_PERSONAL_KEY"],
	] as const)("fails closed when %s lacks %s", (name, key) => {
		const env = templatePresetEnvironment(name);
		delete env[key];
		expect(() => validateTemplatePreset(name, env)).toThrow();
	});
	it.each([
		{ PLATFORM_ENABLED: "false" },
		{ STRIPE_MODE: "live" },
		{ JOURNAL_DATABASE_URL: "postgres://admin:synthetic@localhost/control" },
		{ MIGRATION_DATABASE_URL: "postgres://admin:synthetic@localhost/app" },
		{ APP_NAME: " " },
		{ DEFAULT_LOCALE: "unknown" },
	])(
		"rejects dependency, role and public configuration violations %j",
		(invalid) => {
			expect(() =>
				validateTemplatePreset("commercial-provider", {
					...templatePresetEnvironment("commercial-provider"),
					...invalid,
				}),
			).toThrow();
		},
	);
});

it("renames the actual optional Backoffice image references and preserves a completed repeat", async () => {
	const candidate = await mkdtemp(join(tmpdir(), "phase8-image-rename-"));
	const names = [
		"scripts/backoffice/image-build.ts",
		"scripts/backoffice/image-test.ts",
		"scripts/phase8/image.ts",
	];
	try {
		await writeFile(
			join(candidate, ".phase8-disposable-template"),
			"synthetic adoption fixture\n",
		);
		for (const name of names) {
			const source = await readFile(name, "utf8");
			expect(source).toContain("saas-cook-backoffice:local");
			await mkdir(dirname(join(candidate, name)), { recursive: true });
			await writeFile(join(candidate, name), source);
		}
		expect(await adoptTemplateFixture(candidate, names)).toEqual(names);
		for (const name of names) {
			const adopted = await readFile(join(candidate, name), "utf8");
			expect(adopted).toContain("northstar-work-backoffice:local");
			expect(adopted).not.toContain("saas-cook-backoffice:local");
		}
		expect(await adoptTemplateFixture(candidate, names)).toEqual([]);
	} finally {
		await rm(candidate, { recursive: true, force: true });
	}
});
