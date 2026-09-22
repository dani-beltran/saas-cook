import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		include: ["spikes/phase0/**/*.test.{ts,tsx}"],
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
