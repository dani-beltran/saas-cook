import { z } from "zod";

// Option names only. All visual values live in theme.css.
export const themeOptions = {
	palette: ["teal", "blue", "violet"],
	mode: ["system", "light", "dark"],
	typography: ["system", "humanist", "serif"],
	radius: ["rounded", "square", "soft"],
	shadows: ["subtle", "none"],
	density: ["comfortable", "compact"],
} as const;

const themeConfigSchema = z.object({
	palette: z.enum(themeOptions.palette).catch("teal"),
	mode: z.enum(themeOptions.mode).catch("system"),
	typography: z.enum(themeOptions.typography).catch("system"),
	radius: z.enum(themeOptions.radius).catch("rounded"),
	shadows: z.enum(themeOptions.shadows).catch("subtle"),
	density: z.enum(themeOptions.density).catch("comfortable"),
});

export type ThemeConfig = z.infer<typeof themeConfigSchema>;

/** Invalid fields fall back independently; unknown fields are never forwarded. */
export function resolveThemeConfig(value: unknown = {}): ThemeConfig {
	const parsed = themeConfigSchema.safeParse(value);
	return parsed.success ? parsed.data : themeConfigSchema.parse({});
}

/** Safe to spread on the server-rendered document; no CSS or script serialization. */
export function themeAttributes(value: unknown) {
	const config = resolveThemeConfig(value);
	return {
		"data-palette": config.palette,
		"data-mode": config.mode,
		"data-typography": config.typography,
		"data-radius": config.radius,
		"data-shadows": config.shadows,
		"data-density": config.density,
	};
}
