import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./tests/backoffice",
	workers: 1,
	timeout: 60000,
	reporter: [
		["list"],
		["junit", { outputFile: "artifacts/backoffice/browser.xml" }],
	],
	use: {
		baseURL: "https://localhost:3104",
		ignoreHTTPSErrors: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	outputDir: "artifacts/backoffice/browser",
});
