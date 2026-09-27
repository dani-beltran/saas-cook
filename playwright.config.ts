import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3102";

const group = process.env.E2E_REPORT_GROUP;
const results = group
	? `artifacts/playwright-results/${group}`
	: "artifacts/playwright-results";
const report = group ? `artifacts/playwright/${group}` : "artifacts/playwright";

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: report }],
		["json", { outputFile: `${results}/results.json` }],
	],
	outputDir: results,
	use: { baseURL, trace: "retain-on-failure" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	globalSetup: process.env.PLAYWRIGHT_BASE_URL
		? undefined
		: "./tests/e2e/setup.ts",
});
