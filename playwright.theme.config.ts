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
	// Build first: preview serves immutable files without development HMR/dependency reloads.
	webServer: {
		command:
			"node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 6106 --strictPort --outDir artifacts/storybook",
		url: "http://127.0.0.1:6106/iframe.html",
		timeout: 120_000,
	},
});
