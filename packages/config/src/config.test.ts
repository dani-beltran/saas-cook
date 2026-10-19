import { describe, expect, it } from "vitest";
import { publicConfig } from "./client";
import {
	readMigrationEnv,
	readServeEnv,
	readWebEnv,
	readWorkerEnv,
} from "./server";

const valid = {
	DATABASE_URL: "postgres://web:secret@localhost/app",
	WORKER_DATABASE_URL: "postgres://worker:secret@localhost/app",
	APP_ORIGIN: "https://example.test",
	IDENTITY_DATABASE_URL: "postgres://identity:secret@localhost/app",
	CONTROL_DATABASE_URL: "postgres://reader:secret@localhost/control",
	INSTALLATION_ID: "10000000-0000-4000-8000-000000000001",
	OPENFGA_API_URL: "http://localhost:8080",
	AUTH_SECRET: "synthetic_configuration_test_secret_0000",
	SMTP_HOST: "localhost",
	SMTP_PORT: "1026",
};
describe("runtime configuration", () => {
	it("validates each process without requiring unrelated credentials", () => {
		expect(readWebEnv(valid).APP_ORIGIN).toBe(valid.APP_ORIGIN);
		expect(readWorkerEnv(valid).WORKER_DATABASE_URL).toBe(
			valid.WORKER_DATABASE_URL,
		);
		expect(
			readMigrationEnv({ MIGRATION_DATABASE_URL: valid.DATABASE_URL })
				.MIGRATION_DATABASE_URL,
		).toBe(valid.DATABASE_URL);
		expect(() => readWebEnv({})).toThrow("Invalid runtime configuration");
		expect(() => readWorkerEnv({})).toThrow();
		expect(() => readMigrationEnv({})).toThrow();
	});
	it("rejects malformed configuration without leaking values", () => {
		expect(() =>
			readWebEnv({ ...valid, DATABASE_URL: "secret-password" }),
		).toThrow(/^Invalid runtime configuration/);
		expect(() =>
			readWebEnv({ ...valid, APP_ORIGIN: "https://example.test/path" }),
		).toThrow();
		expect(() =>
			readServeEnv({ ...valid, WORKER_DATABASE_URL: valid.DATABASE_URL }),
		).toThrow("roles must differ");
		expect(() =>
			readServeEnv({ ...valid, MIGRATION_DATABASE_URL: valid.DATABASE_URL }),
		).toThrow("Privileged");
	});
	it("only exposes allowlisted public configuration", () => {
		expect(
			publicConfig({
				...valid,
				APP_NAME: "Demo",
				DEFAULT_LOCALE: "es",
				AUTH_SECRET: "secret",
				AUTH_INGRESS_SECRET: "ingress-secret",
			}),
		).toEqual({ appName: "Demo", defaultLocale: "es" });
	});
	it("validates an independent web-only ingress signing key", () => {
		const configured = {
			...valid,
			AUTH_INGRESS_SECRET: "synthetic_independent_ingress_secret_0000",
		};
		expect(readWebEnv(configured).AUTH_INGRESS_SECRET).toBe(
			configured.AUTH_INGRESS_SECRET,
		);
		expect(readWorkerEnv(configured)).not.toHaveProperty("AUTH_INGRESS_SECRET");
		expect(() =>
			readWebEnv({ ...valid, AUTH_INGRESS_SECRET: "too-short" }),
		).toThrow(/^Invalid runtime configuration/);
		expect(() =>
			readWebEnv({ ...valid, AUTH_INGRESS_SECRET: valid.AUTH_SECRET }),
		).toThrow("signing keys must differ");
	});
	it.each([
		{ DEFAULT_LOCALE: "sensitive-invalid-locale" },
		{ APP_NAME: " " },
		{ APP_NAME: "x".repeat(81) },
	])(
		"rejects invalid public configuration before web startup",
		(environment) => {
			expect(() => readWebEnv({ ...valid, ...environment })).toThrow(
				/^Invalid runtime configuration; check required environment variables$/,
			);
		},
	);
	it.each([
		"MIGRATION_DATABASE_URL",
		"AUTHZ_PUBLISH_TOKEN",
		"TEST_DATABASE_ADMIN_URL",
		"CONTROL_ADMIN_DATABASE_URL",
		"OWNER_RECOVERY_SECRET",
	])("rejects privileged %s in combined serve mode", (key) => {
		expect(() =>
			readServeEnv({ ...valid, [key]: "sensitive-credential" }),
		).toThrow("Privileged command credentials must not be provided to serve");
	});
});

it("validates the server-only Project capacity preset", () => {
	expect(readWebEnv(valid).DEFAULT_PROJECT_CAPACITY).toBe(100);
	expect(
		readWebEnv({
			...valid,
			DEFAULT_PROJECT_CAPACITY: "unlimited",
		}),
	).toMatchObject({
		DEFAULT_PROJECT_CAPACITY: "unlimited",
	});
	for (const value of ["-1", "1.5", "unbounded", "1000001"])
		expect(() =>
			readWebEnv({ ...valid, DEFAULT_PROJECT_CAPACITY: value }),
		).toThrow();
	expect(
		publicConfig({
			...valid,
			DEFAULT_PROJECT_CAPACITY: "100",
		}),
	).not.toHaveProperty("DEFAULT_PROJECT_CAPACITY");
});

it("keeps Foundation credential-free and validates enabled Stripe mode plus local quota policies", () => {
	expect(readWebEnv(valid).BILLING_ENABLED).toBe("false");
	expect(readWebEnv(valid).DEFAULT_PROJECT_CREATES_PER_MONTH).toBe(1000);
	expect(() => readWebEnv({ ...valid, BILLING_ENABLED: "true" })).toThrow(
		"Invalid billing configuration",
	);
	const billing = {
		...valid,
		BILLING_ENABLED: "true",
		STRIPE_MODE: "test",
		STRIPE_SECRET_KEY: "sk_test_synthetic",
		STRIPE_ACCOUNT_ID: "acct_synthetic",
		STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
		STRIPE_PORTAL_CONFIGURATION_ID: "bpc_synthetic",
	};
	expect(readWebEnv(billing).BILLING_ENABLED).toBe("true");
	expect(() => readWorkerEnv({ ...billing, STRIPE_MODE: "live" })).toThrow(
		"Invalid billing configuration",
	);
	for (const value of ["-1", "0.5", "1000001"])
		expect(() =>
			readWebEnv({ ...valid, DEFAULT_PROJECT_CREATES_PER_MONTH: value }),
		).toThrow();
	for (const value of ["0", "101", "80,80"])
		expect(() =>
			readWebEnv({ ...valid, USAGE_NOTICE_THRESHOLDS: value }),
		).toThrow();
	expect(publicConfig(billing)).not.toHaveProperty("STRIPE_SECRET_KEY");
});
