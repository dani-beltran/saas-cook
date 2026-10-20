import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { localeMessages } from "./catalogs";
import { defaultLocale, isLocale, locales, resolveLocale } from "./locales";

function entries(
	value: Record<string, unknown>,
	prefix = "",
): [string, string][] {
	return Object.entries(value).flatMap(([key, child]): [string, string][] => {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof child === "string") return [[path, child]];
		return entries(child as Record<string, unknown>, path);
	});
}

function placeholders(message: string) {
	return [
		...new Set(Array.from(message.matchAll(/\{(\w+)(?:[,}])/g), (m) => m[1])),
	].sort();
}

describe("Phase 6 translation catalogs", () => {
	const reference = new Map(entries(localeMessages(defaultLocale).Phase6));
	for (const locale of locales) {
		it(`${locale} has matching keys/placeholders and formats every message`, () => {
			const messages = localeMessages(locale);
			const catalog = entries(messages.Phase6);
			expect(catalog.map(([key]) => key).sort()).toEqual(
				[...reference.keys()].sort(),
			);
			const t = createTranslator({
				locale,
				messages,
				namespace: "Phase6",
				onError(error) {
					throw error;
				},
			});
			for (const [key, message] of catalog) {
				expect(placeholders(message), `${locale}:${key}`).toEqual(
					placeholders(reference.get(key) ?? ""),
				);
				const values = Object.fromEntries(
					placeholders(message).map((name) => [
						name,
						name === "count" || name === "row" ? 2 : "example",
					]),
				);
				expect(
					t(key as Parameters<typeof t>[0], values),
					`${locale}:${key}`,
				).not.toBe("");
			}
		});
	}
	it("formats singular/plural counts and interpolated row errors", () => {
		const en = createTranslator({
			locale: "en",
			messages: localeMessages("en"),
			namespace: "Phase6",
		});
		const es = createTranslator({
			locale: "es",
			messages: localeMessages("es"),
			namespace: "Phase6",
		});
		expect(en("Data.rowsChecked", { count: 1 })).toBe("1 row checked");
		expect(en("Data.rowsChecked", { count: 2 })).toBe("2 rows checked");
		expect(es("Data.rowsChecked", { count: 1 })).toBe("1 fila revisada");
		expect(es("Data.rowsChecked", { count: 2 })).toBe("2 filas revisadas");
		expect(es("Settings.attempts", { count: 1 })).toBe("1 intento");
		expect(es("Data.row", { row: 4, errors: "duplicado" })).toBe(
			"Fila 4: duplicado",
		);
	});
	it("accepts registered locales and resolves unsupported/missing values centrally", () => {
		for (const locale of locales) {
			expect(isLocale(locale)).toBe(true);
			expect(resolveLocale(locale)).toBe(locale);
		}
		expect(isLocale("xx")).toBe(false);
		expect(resolveLocale("xx")).toBe(defaultLocale);
		expect(resolveLocale(undefined)).toBe(defaultLocale);
	});
});
