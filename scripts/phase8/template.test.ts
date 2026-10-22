import { describe, expect, it } from "vitest";
import { publicConfig } from "../../packages/config/src/client";
import {
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
