import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { dashboardSignUp } from "./dashboard-helpers";

test("appearance previews retain their own modes across account and OS changes", async ({
	page,
}, testInfo) => {
	await dashboardSignUp(page, `preview-${randomUUID()}@example.test`);
	for (const mode of ["Light", "Dark", "System"] as const) {
		await page.getByRole("radio", { name: mode, exact: true }).check();
		await expect(page.locator("html")).toHaveAttribute(
			"data-mode",
			mode.toLowerCase(),
		);
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			await page.locator(".account-appearance").screenshot({
				path: testInfo.outputPath(`${mode}-${colorScheme}.png`),
			});
			for (const previewMode of ["light", "dark", "system"] as const) {
				const dark =
					(previewMode === "system" ? colorScheme : previewMode) === "dark";
				const preview = page.locator(
					`.account-mode-preview.mode-${previewMode}`,
				);
				await expect(preview).toHaveCSS(
					"background-color",
					dark ? "rgb(17, 33, 42)" : "rgb(248, 250, 252)",
				);
				await expect(preview).toHaveCSS(
					"border-top-color",
					dark ? "rgb(54, 82, 94)" : "rgb(214, 224, 228)",
				);
				await expect(preview.locator("span").nth(1)).toHaveCSS(
					"background-color",
					dark ? "rgb(36, 61, 71)" : "rgb(237, 242, 244)",
				);
				await expect(preview.locator("span").first()).toHaveCSS(
					"background-color",
					dark ? "rgb(158, 224, 203)" : "rgb(23, 103, 93)",
				);
			}
		}
	}
});
