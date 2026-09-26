import { expect, test } from "@playwright/test";

test("localized validation, keyboard focus and synthetic organization state", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/en");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"A place to start.",
	);
	await page.screenshot({
		path: testInfo.outputPath("foundation-desktop.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "Validate draft" }).click();
	await expect(page.locator("form").getByRole("alert")).toHaveText(
		"Enter at least 2 characters.",
	);
	await expect(page.getByLabel("Project name")).toBeFocused();
	await page.getByLabel("Project name").fill("Synthetic draft");
	await page.getByRole("button", { name: "Validate draft" }).click();
	await expect(page.locator("form").getByRole("status")).toHaveText(
		"Your draft is valid. Nothing has been saved.",
	);
	await page
		.getByLabel("Demo organization", { exact: true })
		.selectOption("demo-south");
	await expect(page.getByLabel("Project name")).toHaveValue("");
	await expect(page.locator("form").getByRole("status")).toHaveCount(0);
	await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
	await page.getByRole("button", { name: "Validate draft" }).click();
	await expect(page.locator("form").getByRole("alert")).toBeVisible();
	await page
		.getByLabel("Demo organization", { exact: true })
		.selectOption("demo-north");
	await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
	await expect(page.getByLabel("Project name")).toHaveValue("");
	await page
		.getByLabel("Demo organization", { exact: true })
		.selectOption("demo-south");
	await expect(page.getByTestId("current-organization")).toHaveText(
		"South Workshop",
	);
	await page.getByRole("button", { name: "Appearance" }).click();
	await expect(
		page.getByRole("button", { name: "Appearance" }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByLabel("Project name")).toHaveCSS(
		"border-top-width",
		"1px",
	);
	await page.getByLabel("Language").selectOption("es");
	await expect(page).toHaveURL(/\/es$/);
	await expect(page.locator("html")).toHaveAttribute("lang", "es");
	await page.getByRole("button", { name: "Validar borrador" }).click();
	await expect(page.locator("form").getByRole("alert")).toHaveText(
		"Introduce al menos 2 caracteres.",
	);
	expect(errors).toEqual([]);
});

test("mobile shell, static asset and unsupported locale", async ({
	page,
	request,
}, testInfo) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/");
	await expect(page).toHaveURL(/\/en$/);
	await expect(page.getByRole("main")).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("foundation-mobile.png"),
		fullPage: true,
	});
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("link", { name: "Skip to content" }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("main")).toBeFocused();
	const asset = await request.get("/foundation.svg");
	expect(asset.ok()).toBe(true);
	expect(asset.headers()["content-type"]).toContain("image/svg+xml");
	const invalidLocale = await request.get("/fr");
	expect(invalidLocale.status()).toBe(404);
});

test("public diagnostic validates explicit DTOs and generates OpenAPI", async ({
	request,
}) => {
	const response = await request.post("/api/v1/diagnostics/echo", {
		data: { message: "Synthetic request", locale: "es" },
	});
	expect(response.ok()).toBe(true);
	expect(await response.json()).toEqual({
		message: "Synthetic request",
		locale: "es",
		requestId: expect.any(String),
	});
	const invalid = await request.post("/api/v1/diagnostics/echo", {
		data: { message: "", locale: "en", tenantId: "forged" },
	});
	expect(invalid.status()).toBe(422);
	const openapi = await request.get("/api/openapi");
	expect(openapi.ok()).toBe(true);
	expect((await openapi.json()).paths).toHaveProperty("/diagnostics/echo");
});
