import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/theme",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: "artifacts/theme/report" }],
		["json", { outputFile: "artifacts/theme/results.json" }],
	],
	outputDir: "artifacts/theme/results",
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
