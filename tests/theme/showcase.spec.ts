import { expect, test } from "@playwright/test";
import { themeOptions } from "../../packages/ui/src/theme";
import { contrast } from "./contrast";

for (const palette of themeOptions.palette) {
	for (const mode of ["light", "dark"] as const) {
		for (const density of themeOptions.density) {
			test(`${palette} ${mode} ${density}: rendered states, contrast and body portal`, async ({
				page,
			}, testInfo) => {
				await page.goto(
					`/iframe.html?id=foundation-theme--showcase&globals=palette:${palette};mode:${mode};density:${density};locale:en`,
				);
				const root = page.locator("html");
				await expect(root).toHaveAttribute("data-palette", palette);
				await expect(root).toHaveAttribute("data-mode", mode);
				await expect(root).toHaveAttribute("data-density", density);
				const primary = page.getByRole("button", {
					name: "Open dialog",
					exact: true,
				});
				await expect(primary).toBeVisible();
				await expect(
					page.getByRole("button", { name: "Delete", exact: true }),
				).toHaveCSS(
					"background-color",
					await page
						.getByText("Error: could not save.", { exact: true })
						.evaluate((element) => getComputedStyle(element).color),
				);
				for (const locator of [
					page.getByRole("heading", { level: 1 }),
					page.locator("header p"),
					page.getByRole("link", { name: "Projects" }),
					...["Validate draft", "Open dialog", "Secondary", "Delete"].map(
						(name) => page.getByRole("button", { name, exact: true }),
					),
					...["Success:", "Warning:", "Information:", "Error:"].map((name) =>
						page.getByText(name, { exact: false }),
					),
				]) {
					expect(await contrast(locator)).toBeGreaterThanOrEqual(4.5);
				}
				for (const name of ["Open dialog", "Secondary", "Delete"]) {
					const button = page.getByRole("button", { name, exact: true });
					await button.hover();
					expect(await contrast(button)).toBeGreaterThanOrEqual(4.5);
					expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(
						36,
					);
				}
				await page.getByRole("button", { name: "Validate draft" }).click();
				const input = page.getByRole("textbox", { name: "Project name" });
				await expect(input).toBeFocused();
				await expect(input).toHaveCSS("outline-style", "solid");
				await expect(input).toHaveCSS("outline-width", "2px");
				expect(await contrast(page.getByRole("alert"))).toBeGreaterThanOrEqual(
					4.5,
				);
				expect(
					await contrast(input, "border-top-color"),
				).toBeGreaterThanOrEqual(3);
				expect(await contrast(input, "outline-color")).toBeGreaterThanOrEqual(
					3,
				);
				await input.fill("Website refresh");
				await input.selectText();
				expect(
					await contrast(input, "color", "::selection"),
				).toBeGreaterThanOrEqual(4.5);
				expect(
					await contrast(input, "color", "::placeholder"),
				).toBeGreaterThanOrEqual(4.5);
				await page.getByRole("button", { name: "Validate draft" }).click();
				await expect(page.getByRole("status")).toBeVisible();
				expect(
					await contrast(input, "border-top-color"),
				).toBeGreaterThanOrEqual(3);
				for (const width of [1440, 390]) {
					await page.setViewportSize({ width, height: 1000 });
					expect(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
					).toBe(true);
					await page.screenshot({
						path: testInfo.outputPath(`${width}.png`),
						fullPage: true,
					});
				}
				await primary.focus();
				await page.keyboard.press("Enter");
				const dialog = page.getByRole("dialog");
				await expect(dialog).toBeVisible();
				expect(
					await dialog.evaluate(
						(element) => element.parentElement === document.body,
					),
				).toBe(true);
				await expect(dialog).toHaveCSS(
					"background-color",
					mode === "dark" ? "rgb(25, 45, 55)" : "rgb(255, 255, 255)",
				);
				expect(await contrast(dialog)).toBeGreaterThanOrEqual(4.5);
				expect(await contrast(dialog.locator("p"))).toBeGreaterThanOrEqual(4.5);
				expect(
					await dialog.evaluate(
						(element) =>
							getComputedStyle(element, "::backdrop").backgroundColor,
					),
				).not.toBe("rgba(0, 0, 0, 0)");
				await page.screenshot({ path: testInfo.outputPath("portal.png") });
				await page.keyboard.press("Escape");
				await expect(dialog).toHaveCount(0);
				await expect(primary).toBeFocused();
			});
		}
	}
}

test("Spanish, System changes, reduced motion, forced colors and shape settings", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await page.goto(
		"/iframe.html?id=foundation-theme--showcase&globals=mode:system;locale:es;radius:square;shadows:none;typography:serif",
	);
	const primary = page.getByRole("button", { name: "Abrir diálogo" });
	await expect(primary).toHaveCSS("border-radius", "0px");
	await expect(
		page.getByRole("heading", { name: "Tu próximo proyecto", exact: true }),
	).toHaveCSS("font-family", 'Georgia, "Times New Roman", serif');
	await expect(page.locator("#theme-form")).toHaveCSS("box-shadow", "none");
	await expect(primary).toHaveCSS("transition-duration", "0s");
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		"rgb(17, 33, 42)",
	);
	await page.emulateMedia({ colorScheme: "light" });
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		"rgb(248, 250, 252)",
	);
	await page.emulateMedia({ forcedColors: "active" });
	await primary.focus();
	await expect(primary).toHaveCSS("outline-style", "solid");
	await expect(primary).toHaveCSS("outline-width", "2px");
	await page.keyboard.press("Enter");
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(primary).toBeFocused();
});
