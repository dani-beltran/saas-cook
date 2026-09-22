import { expect, test } from "@playwright/test";
test("React 19/Next/next-intl/RHF/Zod browser compatibility", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Phase 0 adapter validation" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Validate", exact: true }).click();
	await expect(page.locator("#name-error")).toHaveText("Enter a name");
	await page.getByLabel("Project name").fill("Synthetic project");
	await page.getByRole("button", { name: "Validate", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Valid input");
	await expect(page.getByLabel("Project name")).toHaveCSS(
		"border-top-width",
		"1px",
	);
	expect(errors).toEqual([]);
});
