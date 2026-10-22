import { defineConfig, devices } from "@playwright/test";
import { playwrightEvidencePaths } from "./scripts/phase8/verification-artifacts";

const reports = playwrightEvidencePaths("theme", process.env);

export default defineConfig({
	testDir: "./tests/theme",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: reports.html }],
		["json", { outputFile: reports.json }],
	],
	outputDir: reports.results,
	use: { baseURL: "http://127.0.0.1:6106", trace: "retain-on-failure" },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command:
			"node node_modules/storybook/dist/bin/dispatcher.js dev --ci --port 6106 --config-dir apps/web/.storybook --disable-telemetry",
		url: "http://127.0.0.1:6106",
		timeout: 120_000,
	},
});
