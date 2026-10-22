import { expect, test } from "@playwright/test";

const required = (key: string) => {
	const value = process.env[key];
	if (!value) throw new Error(`Missing fixture ${key}`);
	return value;
};

test("invited staff passkey, audited scoped lookup, separate cookie and Spanish states", async ({
	page,
	context,
}) => {
	const origin = "https://localhost:3104";
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.emulateMedia({ colorScheme: "light" });
	const cdp = await context.newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	await page.goto("/en");
	await expect(
		page.getByRole("heading", { name: "Staff backoffice" }),
	).toBeVisible();
	// Shared component CSS must be compiled, not merely imported as JSX.
	const signIn = page.getByRole("button", { name: "Sign in with a passkey" });
	expect(
		await signIn.evaluate((button) => ({
			height: button.getBoundingClientRect().height,
			background: getComputedStyle(button).backgroundColor,
		})),
	).toMatchObject({ height: 40 });
	expect(
		await signIn.evaluate((button) => getComputedStyle(button).backgroundColor),
	).not.toBe("rgba(0, 0, 0, 0)");
	await expect(page.locator("[data-slot=card]")).toHaveCount(3);
	await page.screenshot({
		path: "artifacts/backoffice/workspace-empty.png",
		fullPage: true,
	});
	await page.getByLabel("Organization ID").fill("invalid");
	await page.getByRole("button", { name: "Look up organization" }).focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("status")).toContainText(
		"Enter a valid organization UUID",
	);
	await expect(page.getByLabel("Organization ID")).toHaveAttribute(
		"aria-describedby",
		"organization-error",
	);
	await expect(page.locator("#organization-error")).toBeVisible();
	await page.getByLabel("Invitation code").fill(required("BO_TEST_INVITATION"));
	await page.getByRole("button", { name: "Enroll invited passkey" }).click();
	await expect(page.getByRole("status")).toContainText("Passkey enrolled");
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	await expect(page.getByRole("status")).toContainText("Signed in");
	const cookie = (await context.cookies()).find(
		(c) => c.name === "__Host-backoffice-session",
	);
	expect(cookie?.secure).toBe(true);
	expect(cookie?.httpOnly).toBe(true);
	expect(cookie?.sameSite).toBe("Strict");
	expect(cookie?.path).toBe("/");
	await page
		.getByLabel("Organization ID")
		.fill(required("BO_TEST_ORGANIZATION"));
	await page.getByLabel("Case reference").fill("BO-BROWSER-1");
	await page.route("**/api/organizations/lookup", async (route) => {
		const response = await route.fetch();
		await new Promise((resolve) => setTimeout(resolve, 300));
		await route.fulfill({ response });
	});
	await page.getByRole("button", { name: "Look up organization" }).click();
	await expect(
		page.getByRole("button", { name: "Look up organization" }),
	).toBeDisabled();
	await expect(page.getByRole("status")).toHaveText("Working…");
	await expect(
		page.getByRole("heading", { name: "Synthetic authorized organization" }),
	).toBeVisible();
	await expect(
		page.getByText("Audit reference", { exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: "artifacts/backoffice/lookup.png",
		fullPage: true,
	});
	await page.unroute("**/api/organizations/lookup");
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.getByLabel("Language")).toHaveCSS(
		"color",
		"rgb(237, 245, 246)",
	);
	await page.screenshot({
		path: "artifacts/backoffice/workspace-dark.png",
		fullPage: true,
	});
	await page.emulateMedia({ colorScheme: "light" });
	await page
		.getByLabel("Organization ID")
		.fill(required("BO_TEST_OTHER_ORGANIZATION"));
	await page.getByRole("button", { name: "Look up organization" }).click();
	await expect(page.getByRole("status")).toContainText("Access unavailable");
	await expect(
		page.getByText("Other organization", { exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Sign out" }).click();
	await page
		.getByLabel("Organization ID")
		.fill(required("BO_TEST_ORGANIZATION"));
	await page.getByRole("button", { name: "Look up organization" }).click();
	await expect(page.getByRole("status")).toContainText("Access unavailable");
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/es");
	await expect(
		page.getByRole("heading", { name: "Administración interna" }),
	).toBeVisible();
	await expect(page.getByLabel("Idioma")).toHaveValue("es");
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: "artifacts/backoffice/workspace-spanish-mobile.png",
		fullPage: true,
	});
	expect(browserErrors).toEqual([]);
	const direct = await context.request.get(`${origin}/en`);
	expect(direct.status()).toBe(200);
});
