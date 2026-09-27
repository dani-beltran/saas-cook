import { resolveThemeConfig, type ThemeConfig } from "@saas-cook/ui/theme";

/** Developer-owned product appearance. Rebuild after editing; see docs/development/theming.md. */
export const productTheme = resolveThemeConfig({
	palette: "teal",
	mode: "system",
	typography: "system",
	radius: "rounded",
	shadows: "subtle",
	density: "comfortable",
} satisfies ThemeConfig);
