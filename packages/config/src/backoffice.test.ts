import { expect, it } from "vitest";
import { backofficeConfig } from "./backoffice";

const env = {
	NODE_ENV: "test" as const,
	BACKOFFICE_ORIGIN: "https://staff.example.test",
	BACKOFFICE_AUTH_SECRET: "synthetic_operator_auth_secret_0000000001",
	BACKOFFICE_IDENTITY_DATABASE_URL:
		"postgres://saas_cook_bo_identity:synthetic@localhost/test",
	BACKOFFICE_DATABASE_URL:
		"postgres://saas_cook_bo_query:synthetic@localhost/test",
	CONTROL_DATABASE_URL:
		"postgres://saas_cook_control_reader:synthetic@localhost/test",
	INSTALLATION_ID: "11111111-1111-4111-8111-111111111111",
	OPENFGA_API_URL: "http://localhost:8080",
	BACKOFFICE_ENVIRONMENT: "production",
};
it("accepts public staff configuration without ingress keys or CIDRs", () => {
	expect(backofficeConfig(env).BACKOFFICE_ORIGIN).toBe(env.BACKOFFICE_ORIGIN);
});
it("preserves production HTTPS, independent secrets/origin and restricted roles", () => {
	for (const change of [
		{ BACKOFFICE_ORIGIN: "http://localhost:3001" },
		{ BACKOFFICE_ORIGIN: env.BACKOFFICE_ORIGIN + "/path" },
		{ AUTH_SECRET: env.BACKOFFICE_AUTH_SECRET },
		{ APP_ORIGIN: env.BACKOFFICE_ORIGIN },
		{ BACKOFFICE_DATABASE_URL: "postgres://postgres:synthetic@localhost/test" },
	])
		expect(() => backofficeConfig({ ...env, ...change })).toThrow();
	expect(
		backofficeConfig({
			...env,
			BACKOFFICE_ENVIRONMENT: "development",
			BACKOFFICE_ORIGIN: "http://localhost:3001",
		}).BACKOFFICE_ORIGIN,
	).toBe("http://localhost:3001");
});
