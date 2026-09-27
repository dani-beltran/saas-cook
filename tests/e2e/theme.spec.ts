import { expect, test } from "@playwright/test";
import { themeAttributes, themeOptions } from "../../packages/ui/src/theme";

import { contrast } from "../theme/contrast";

const backgrounds = { light: "rgb(248, 250, 252)", dark: "rgb(17, 33, 42)" };

for (const scheme of ["light", "dark"] as const) {
	test(`${scheme}: server roots have the correct appearance with JavaScript disabled`, async ({
		browser,
		baseURL,
	}) => {
		const context = await browser.newContext({
			baseURL,
			javaScriptEnabled: false,
			colorScheme: scheme,
		});
		const page = await context.newPage();
		for (const path of [
			"/en/patterns",
			"/en/account",
			"/auth/reset-password",
			"/auth/confirm",
		]) {
			await page.goto(path);
			for (const [key, value] of Object.entries(themeAttributes({})))
				await expect(page.locator("html")).toHaveAttribute(key, value);
			await expect(page.locator("body")).toHaveCSS(
				"background-color",
				backgrounds[scheme],
			);
			await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
				"content",
				"light dark",
			);
		}
		await context.close();
	});
}

test("System follows OS changes across root layouts, ignores old storage, and hydrates without mutation", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		const expectedAnonymousSession =
			message.location().url.endsWith("/api/auth/get-session") &&
			message.text().includes("401 (Unauthorized)");
		if (message.type() === "error" && !expectedAnonymousSession)
			errors.push(message.text());
	});
	await page.addInitScript(() => {
		localStorage.setItem("common-saas-appearance", "dark");
	});
	for (const path of [
		"/en/patterns",
		"/en/account",
		"/auth/reset-password",
		"/auth/confirm",
	]) {
		await page.emulateMedia({ colorScheme: "light" });
		// Hold framework scripts so CSS/SSR appearance can be compared before hydration.
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/_next/**/*.js*", async (route) => {
			await held;
			await route.continue();
		});
		await page.goto(path, { waitUntil: "commit" });
		await expect(page.locator("body")).toHaveCSS(
			"background-color",
			backgrounds.light,
		);
		const before = await page
			.locator("html")
			.evaluate((root) => root.outerHTML.match(/<html[^>]*>/)?.[0]);
		release();
		await page.waitForLoadState("networkidle");
		await page.unroute("**/_next/**/*.js*");
		expect(
			await page
				.locator("html")
				.evaluate((root) => root.outerHTML.match(/<html[^>]*>/)?.[0]),
		).toBe(before);
		await expect(page.locator("body")).toHaveCSS(
			"background-color",
			backgrounds.light,
		);
		await page.emulateMedia({ colorScheme: "dark" });
		await expect(page.locator("body")).toHaveCSS(
			"background-color",
			backgrounds.dark,
		);
		await page.emulateMedia({ colorScheme: "light" });
		await expect(page.locator("body")).toHaveCSS(
			"background-color",
			backgrounds.light,
		);
		await expect(
			page.getByRole("button", { name: /Toggle color theme|Appearance/ }),
		).toHaveCount(0);
	}
	expect(errors).toEqual([]);
});

test("fixed developer modes and every palette stay stable when the OS changes", async ({
	page,
}) => {
	await page.goto("/en/patterns");
	for (const palette of themeOptions.palette) {
		for (const mode of ["light", "dark"] as const) {
			// Test the production attribute contract without adding a runtime settings API.
			await page.locator("html").evaluate((root, attributes) => {
				for (const [key, value] of Object.entries(attributes))
					root.setAttribute(key, value);
			}, themeAttributes({ palette, mode }));
			for (const colorScheme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme });
				await expect(page.locator("body")).toHaveCSS(
					"background-color",
					backgrounds[mode],
				);
				await expect(page.locator("html")).toHaveCSS(
					"color-scheme",
					`${mode} only`,
				);
			}
		}
	}
});

test("authentication pages use all palettes at desktop and mobile widths", async ({
	page,
}, testInfo) => {
	for (const path of ["/en/account", "/auth/reset-password?locale=es"]) {
		await page.goto(path);
		await page.waitForLoadState("networkidle");
		const email = page.locator("input[type=email]");
		if (await email.count()) await email.fill("synthetic@example.test");
		for (const palette of themeOptions.palette) {
			for (const mode of ["light", "dark"] as const) {
				await page.locator("html").evaluate((root, attributes) => {
					for (const [key, value] of Object.entries(attributes))
						root.setAttribute(key, value);
				}, themeAttributes({ palette, mode }));
				for (const selector of [
					".auth-heading p",
					".auth-link",
					".auth-primary",
					".auth-secondary",
					".auth-error",
				]) {
					const element = page.locator(selector).first();
					if (await element.isVisible())
						expect(await contrast(element), selector).toBeGreaterThanOrEqual(
							4.5,
						);
				}
				const input = page.locator("input[data-slot=input]:visible").first();
				if (await input.count()) {
					expect(
						await contrast(input, "border-top-color"),
					).toBeGreaterThanOrEqual(3);
					expect(await contrast(input)).toBeGreaterThanOrEqual(4.5);
					if (await input.getAttribute("placeholder"))
						expect(
							await contrast(input, "color", "::placeholder"),
						).toBeGreaterThanOrEqual(4.5);
				}
				for (const width of [1440, 390]) {
					await page.setViewportSize({ width, height: 1000 });
					await expect(page.getByRole("main")).toBeVisible();
					expect(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
					).toBe(true);
					await page.screenshot({
						path: testInfo.outputPath(
							`${path.includes("account") ? "sign-in" : "reset"}-${palette}-${mode}-${width}.png`,
						),
						fullPage: true,
					});
				}
			}
		}
	}
});
