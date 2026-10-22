import type { StorybookConfig } from "@storybook/nextjs-vite";

export default {
	framework: "@storybook/nextjs-vite",
	stories: [
		"../../../packages/ui/src/**/*.stories.tsx",
		"../src/components/**/*.stories.tsx",
		"../../backoffice/src/components/**/*.stories.tsx",
		"../src/features/**/*.stories.tsx",
	],
	core: { disableTelemetry: true },
} satisfies StorybookConfig;
