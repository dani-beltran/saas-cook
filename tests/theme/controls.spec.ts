import { expect, test } from "@playwright/test";

for (const mode of ["light", "dark"]) {
	test(`shared controls preserve form data, validation and keyboard behavior in ${mode} mode`, async ({
		page,
	}) => {
		await page.goto(
			`/iframe.html?id=foundation-controls--default&globals=mode:${mode};locale:en`,
		);
		const status = page.getByLabel("Status", { exact: true });
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(status).toBeFocused();
		await expect(status).toHaveAttribute("aria-invalid", "true");
		await expect(page.getByRole("alert")).toHaveText("Choose a status");
		await status.selectOption("active");
		await page.getByLabel("Notes").fill("A draft with notes");
		const checkbox = page.getByRole("checkbox", { name: "Receive notices" });
		await page.getByText("Receive notices", { exact: true }).click();
		await expect(checkbox).toBeChecked();
		await checkbox.focus();
		await page.keyboard.press("Space");
		await expect(checkbox).not.toBeChecked();
		await page.keyboard.press("Space");
		await page.getByRole("radio", { name: "Light", exact: true }).focus();
		await page.keyboard.press("ArrowRight");
		await expect(
			page.getByRole("radio", { name: "Dark", exact: true }),
		).toBeFocused();
		await expect(
			page.getByRole("radio", { name: "Dark", exact: true }),
		).toBeChecked();
		await expect(
			page.getByText("Appearance changes: 1", { exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.getByRole("status")).toHaveText(
			JSON.stringify({
				status: "active",
				notes: "A draft with notes",
				notify: "on",
				appearance: "dark",
			}),
		);
		await page.getByRole("button", { name: "Reset", exact: true }).click();
		await expect(status).toHaveValue("");
		await expect(page.getByLabel("Notes")).toHaveValue("");
		await expect(checkbox).not.toBeChecked();
		await expect(page.getByRole("table", { name: "Results" })).toBeVisible();
		await expect(
			page.getByRole("columnheader", { name: "Name" }),
		).toBeVisible();
	});
}

test("shared dialog traps focus, blocks busy dismissal and restores its opener", async ({
	page,
}) => {
	await page.goto("/iframe.html?id=foundation-controls--default");
	const opener = page.getByRole("button", { name: "Review", exact: true });
	await opener.click();
	const dialog = page.getByRole("dialog", { name: "Review changes" });
	await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
	await expect(page.getByRole("checkbox", { name: "Saving" })).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
	await page.keyboard.press("Tab");
	const busy = dialog.getByRole("checkbox", { name: "Saving" });
	await expect(busy).toBeFocused();
	await page.keyboard.press("Space");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
	await page.keyboard.press("Space");
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(opener).toBeFocused();
});

test("shared controls retain disabled and localized states", async ({
	page,
}) => {
	await page.goto("/iframe.html?id=foundation-controls--disabled");
	for (const control of [
		page.getByLabel("Status", { exact: true }),
		page.getByLabel("Notes"),
		page.getByRole("checkbox"),
		page.getByRole("radio", { name: "Dark", exact: true }),
		page.getByRole("button", { name: "Save", exact: true }),
	])
		await expect(control).toBeDisabled();
	await page.goto("/iframe.html?id=foundation-controls--spanish");
	await expect(page.getByLabel("Estado", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("radiogroup", { name: "Apariencia" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Revisar", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "Revisar cambios" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Cerrar" }).click();
	await expect(
		page.getByRole("button", { name: "Revisar", exact: true }),
	).toBeFocused();
});
