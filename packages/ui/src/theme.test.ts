import { describe, expect, it } from "vitest";
import { resolveThemeConfig, themeAttributes, themeOptions } from "./theme";

describe("developer theme configuration", () => {
	it("defaults to the existing palette, System and Comfortable", () => {
		expect(resolveThemeConfig()).toEqual({
			palette: "teal",
			mode: "system",
			typography: "system",
			radius: "rounded",
			shadows: "subtle",
			density: "comfortable",
		});
	});
	it.each([undefined, null, [], "dark", 1])(
		"falls back safely for malformed configuration: %j",
		(value) => {
			expect(resolveThemeConfig(value)).toEqual(resolveThemeConfig());
		},
	);
	it("falls back per field without accepting CSS, HTML, URLs or unknown keys", () => {
		const config = resolveThemeConfig({
			palette: "blue",
			mode: "<script>",
			density: "tiny",
			typography: "url(https://example.test/font)",
			radius: "1px; color:red",
			shadows: {},
			organizationId: "forged",
			style: "color:red",
		});
		expect(config).toEqual({ ...resolveThemeConfig(), palette: "blue" });
		expect(themeAttributes(config)).toEqual({
			"data-palette": "blue",
			"data-mode": "system",
			"data-density": "comfortable",
			"data-typography": "system",
			"data-radius": "rounded",
			"data-shadows": "subtle",
		});
	});
	it("accepts every supported option without browser globals", () => {
		for (const [key, values] of Object.entries(themeOptions)) {
			for (const value of values)
				expect(resolveThemeConfig({ [key]: value })).toHaveProperty(key, value);
		}
	});
});
