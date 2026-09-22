import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: ".",
	testMatch: "browser.spec.ts",
	workers: 1,
	use: { baseURL: "http://127.0.0.1:3120", headless: true },
	webServer: {
		command:
			"node ../../../node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3120",
		url: "http://127.0.0.1:3120",
		reuseExistingServer: false,
		env: { PHASE0_API_FIXTURES: "1" },
		timeout: 30000,
	},
	reporter: [["list"]],
	outputDir: "../../../artifacts/phase0-browser",
});
