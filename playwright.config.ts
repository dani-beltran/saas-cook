import { defineConfig, devices } from "@playwright/test";
import { playwrightEvidencePaths } from "./scripts/phase8/verification-artifacts";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3102";

const reports = playwrightEvidencePaths("browser", process.env);

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: reports.html }],
		["json", { outputFile: reports.json }],
	],
	outputDir: reports.results,
	use: { baseURL, trace: "retain-on-failure" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	globalSetup: process.env.PLAYWRIGHT_BASE_URL
		? undefined
		: "./tests/e2e/setup.ts",
});
