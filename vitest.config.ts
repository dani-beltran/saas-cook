import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		reporters: ["default", "junit"],
		outputFile: {
			junit: process.env.VITEST_REPORT ?? "artifacts/vitest/results.xml",
		},
		projects: [
			{
				test: {
					name: "unit",
					include: [
						"{apps,packages}/**/*.test.{ts,tsx}",
						"scripts/phase1/**/*.test.ts",
						"scripts/phase3/**/*.test.ts",
						"scripts/phase4/**/*.test.ts",
						"scripts/phase8/**/*.test.ts",
					],
					exclude: ["**/*.integration.test.{ts,tsx}", "**/node_modules/**"],
				},
			},
			{
				test: {
					name: "integration",
					include: ["{apps,packages}/**/*.integration.test.{ts,tsx}"],
					testTimeout: 30_000,
					hookTimeout: 60_000,
					fileParallelism: false,
				},
			},
		],
	},
});
