import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3102";

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: "artifacts/playwright" }],
	],
	outputDir: "artifacts/playwright-results",
	use: { baseURL, trace: "retain-on-failure" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: process.env.PLAYWRIGHT_BASE_URL
		? undefined
		: {
				command: "node apps/web/.next/standalone/apps/web/server.js",
				url: baseURL,
				stdout: "pipe",
				stderr: "pipe",
				reuseExistingServer: false,
				timeout: 60_000,
				env: {
					HOSTNAME: "127.0.0.1",
					PORT: new URL(baseURL).port,
					APP_ORIGIN: baseURL,
					DATABASE_URL:
						process.env.DATABASE_URL ??
						"postgresql://common_saas_web:local_phase1@127.0.0.1:55433/common_saas",
					IDENTITY_DATABASE_URL:
						process.env.IDENTITY_DATABASE_URL ??
						"postgres://common_saas_identity:local_phase1@127.0.0.1:55433/common_saas",
					CONTROL_DATABASE_URL:
						process.env.CONTROL_DATABASE_URL ??
						"postgres://common_saas_control_reader:local_phase2_control@127.0.0.1:55434/common_saas_control",
					INSTALLATION_ID:
						process.env.INSTALLATION_ID ??
						"10000000-0000-4000-8000-000000000001",
					AUTH_SECRET:
						process.env.AUTH_SECRET ??
						"local_phase2_synthetic_secret_not_for_production_0001",
					OPENFGA_API_URL:
						process.env.OPENFGA_API_URL ?? "http://127.0.0.1:18081",
					APP_NAME: "Common SaaS",
					DEFAULT_LOCALE: "en",
				},
			},
});
