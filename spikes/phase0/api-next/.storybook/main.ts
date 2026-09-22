import type { StorybookConfig } from "@storybook/nextjs-vite";
export default {
	framework: "@storybook/nextjs-vite",
	stories: ["../*.stories.tsx"],
	core: { disableTelemetry: true },
} satisfies StorybookConfig;
