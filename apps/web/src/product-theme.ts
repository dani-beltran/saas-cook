import { resolveThemeConfig, type ThemeConfig } from "@common-saas/ui/theme";
import type { Viewport } from "next";

/** Developer-owned product appearance. Rebuild after editing; see docs/development/theming.md. */
export const productTheme = resolveThemeConfig({
	palette: "teal",
	mode: "system",
	typography: "system",
	radius: "rounded",
	shadows: "subtle",
	density: "comfortable",
} satisfies ThemeConfig);

export const productViewport: Viewport = {
	colorScheme:
		productTheme.mode === "system" ? "light dark" : productTheme.mode,
};
