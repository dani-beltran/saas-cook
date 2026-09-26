import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

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
				reuseExistingServer: !process.env.CI,
				timeout: 60_000,
				env: {
					HOSTNAME: "127.0.0.1",
					APP_ORIGIN: baseURL,
					DATABASE_URL:
						process.env.DATABASE_URL ??
						"postgresql://web:synthetic@127.0.0.1:5432/common_saas",
					APP_NAME: "Common SaaS",
					DEFAULT_LOCALE: "en",
				},
			},
});
