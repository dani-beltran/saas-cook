import type { StorybookConfig } from "@storybook/nextjs-vite";

export default {
	framework: "@storybook/nextjs-vite",
	stories: ["../../../packages/ui/src/**/*.stories.tsx"],
	core: { disableTelemetry: true },
} satisfies StorybookConfig;
