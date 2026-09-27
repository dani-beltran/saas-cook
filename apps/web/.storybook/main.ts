import type { StorybookConfig } from "@storybook/nextjs-vite";

export default {
	framework: "@storybook/nextjs-vite",
	stories: [
		"../../../packages/ui/src/**/*.stories.tsx",
		"../src/components/**/*.stories.tsx",
	],
	core: { disableTelemetry: true },
} satisfies StorybookConfig;
