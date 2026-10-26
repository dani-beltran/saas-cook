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
	await expect(page.locator("[data-slot=card]")).toHaveCount(1);
	await page.screenshot({
		path: "artifacts/backoffice/workspace-empty.png",
		fullPage: true,
	});
	await expect(page.locator("#organization-directory")).toHaveCount(0);
	await expect(page.locator("#organization-lookup")).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: "Organizations", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Sign out", exact: true }),
	).toHaveCount(0);
	await page.getByLabel("Invitation code").fill(required("BO_TEST_INVITATION"));
	await page.getByRole("button", { name: "Enroll invited passkey" }).click();
	await expect(page.locator(".bo-feedback").first()).toContainText(
		"Passkey enrolled",
	);
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	await expect(page.locator(".bo-feedback").first()).toContainText("Signed in");
	await expect(page.locator("#organization-directory")).toBeVisible();
	await expect(page.locator("#organization-lookup")).toBeHidden();
	await expect(page.getByLabel("Invitation code")).toHaveCount(0);
	await expect(page.locator("#staff-access")).toHaveCount(0);
	await page.getByRole("link", { name: "Staff access", exact: true }).click();
	await expect(page).toHaveURL(/\/en\/staff-access$/);
	await expect(page.locator("#staff-access")).toBeVisible();
	await expect(page.locator("#organization-directory")).toHaveCount(0);
	await expect(page.locator("#organization-lookup")).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: "Staff access", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await page.reload();
	await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
	await page.getByLabel("Language").selectOption("es");
	await expect(page).toHaveURL(/\/es\/staff-access$/);
	await expect(
		page.getByRole("button", { name: "Cerrar sesión", exact: true }),
	).toBeVisible();
	await page.getByLabel("Idioma").selectOption("en");
	await page.getByRole("link", { name: "Organizations", exact: true }).click();
	await expect(
		page.getByRole("link", { name: "Organizations", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await page.reload();
	await expect(page.locator("#organization-directory")).toBeVisible();
	await page.getByText("Look up by organization ID", { exact: true }).click();
	await page.getByLabel("Organization ID", { exact: true }).fill("invalid");
	await page.getByRole("button", { name: "Look up organization" }).focus();
	await page.keyboard.press("Enter");
	await expect(page.locator(".bo-feedback").first()).toContainText(
		"Enter a valid organization UUID",
	);
	await expect(
		page.getByLabel("Organization ID", { exact: true }),
	).toHaveAttribute("aria-describedby", "organization-error");
	await expect(page.locator("#organization-error")).toBeVisible();
	const cookie = (await context.cookies()).find(
		(c) => c.name === "__Host-backoffice-session",
	);
	expect(cookie?.secure).toBe(true);
	expect(cookie?.httpOnly).toBe(true);
	expect(cookie?.sameSite).toBe("Strict");
	expect(cookie?.path).toBe("/");
	await page
		.getByLabel("Organization ID", { exact: true })
		.fill(required("BO_TEST_ORGANIZATION"));
	await page.getByLabel("Case reference", { exact: true }).fill("BO-BROWSER-1");
	await page.route("**/api/organizations/lookup", async (route) => {
		const response = await route.fetch();
		await new Promise((resolve) => setTimeout(resolve, 300));
		await route.fulfill({ response });
	});
	await page.getByRole("button", { name: "Look up organization" }).click();
	await expect(
		page.getByRole("button", { name: "Look up organization" }),
	).toBeDisabled();
	await expect(page.locator(".bo-feedback").first()).toHaveText("Working…");
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
	await page.getByRole("link", { name: "Back to organizations" }).click();
	await page.getByText("Look up by organization ID", { exact: true }).click();
	await page
		.getByLabel("Organization ID", { exact: true })
		.fill(required("BO_TEST_OTHER_ORGANIZATION"));
	await page.getByLabel("Case reference", { exact: true }).fill("BO-BROWSER-2");
	await page.getByRole("button", { name: "Look up organization" }).click();
	await expect(page.locator(".bo-feedback").first()).toContainText(
		"Access unavailable",
	);
	await expect(
		page.getByText("Other organization", { exact: true }),
	).toHaveCount(0);

	await page.getByRole("link", { name: "Back to organizations" }).click();
	const directory = page.locator("#organization-directory");
	await directory.getByRole("button", { name: "Search directory" }).click();
	await expect(directory.getByRole("status")).toContainText(
		"Check the optional",
	);
	await directory
		.getByLabel("Directory case reference")
		.fill("BO-DIRECTORY-BROWSER");
	await directory.getByRole("button", { name: "Search directory" }).focus();
	await page.keyboard.press("Enter");
	await expect(directory.locator("tbody tr")).toHaveCount(10);
	await expect(
		directory.getByText("Live source", { exact: true }),
	).toBeVisible();
	await expect(directory).toContainText("Synthetic directory organization");
	await expect(directory).not.toContainText("Other organization");
	const firstIds = await directory.locator("tbody tr code").allTextContents();
	await directory.getByRole("button", { name: "Next page" }).click();
	await expect(directory.locator("tbody tr")).toHaveCount(2);
	const nextIds = await directory.locator("tbody tr code").allTextContents();
	await directory.getByRole("button", { name: "Previous page" }).click();
	await expect(directory.locator("tbody tr")).toHaveCount(10);
	expect(await directory.locator("tbody tr code").allTextContents()).toEqual(
		firstIds,
	);
	await directory.getByRole("button", { name: "Next page" }).click();
	await expect(directory.locator("tbody tr")).toHaveCount(2);
	expect(new Set([...firstIds, ...nextIds]).size).toBe(12);
	await expect(
		directory.getByRole("button", { name: "Next page" }),
	).toHaveCount(0);
	await directory.getByLabel("Lifecycle filter").selectOption("suspended");
	await expect(directory.locator("tbody tr")).toHaveCount(0);
	await directory.getByRole("button", { name: "Search directory" }).click();
	await expect(
		directory.getByText("No matching organizations in your current scope."),
	).toBeVisible();
	await directory.getByLabel("Lifecycle filter").selectOption("");
	await directory
		.getByLabel("Filter by exact organization ID (optional)")
		.fill(required("BO_TEST_OTHER_ORGANIZATION"));
	await directory.getByRole("button", { name: "Search directory" }).click();
	await expect(
		directory.getByText("No matching organizations in your current scope."),
	).toBeVisible();
	await directory
		.getByLabel("Filter by exact organization ID (optional)")
		.fill(required("BO_TEST_ORGANIZATION"));
	await directory.getByRole("button", { name: "Search directory" }).click();
	await expect(directory.locator("tbody tr")).toHaveCount(1);
	let detailRequest: Record<string, string> | undefined;
	page.on("request", (request) => {
		if (request.url().endsWith("/api/organizations/lookup"))
			detailRequest = request.postDataJSON();
	});
	await directory
		.getByRole("button", {
			name: `View details for ${required("BO_TEST_ORGANIZATION")}`,
			exact: true,
		})
		.click();
	await expect(
		page.getByRole("heading", { name: "Synthetic authorized organization" }),
	).toBeVisible();
	expect(detailRequest).toEqual({
		organizationId: required("BO_TEST_ORGANIZATION"),
		caseReference: "BO-DIRECTORY-BROWSER",
	});
	await expect(page).toHaveURL(
		new RegExp(`/en/organizations/${required("BO_TEST_ORGANIZATION")}$`),
	);
	await expect(directory).toHaveCount(0);
	await expect(page.locator("#overview-title")).toBeFocused();
	await page.reload();
	await expect(
		page.getByRole("heading", { name: "Synthetic authorized organization" }),
	).toBeVisible();
	await page.evaluate(
		(id) => sessionStorage.removeItem(`bo-detail-case:${id}`),
		required("BO_TEST_ORGANIZATION"),
	);
	await page.reload();
	await expect(
		page.getByLabel("Case reference", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Synthetic authorized organization" }),
	).toHaveCount(0);
	await page
		.getByLabel("Case reference", { exact: true })
		.fill("BO-DIRECTORY-BROWSER");
	await page.getByRole("button", { name: "Look up organization" }).click();
	await expect(
		page.getByRole("heading", { name: "Synthetic authorized organization" }),
	).toBeVisible();
	await page.screenshot({
		path: "artifacts/backoffice/directory/results.png",
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: "artifacts/backoffice/directory-table/mobile.png",
		fullPage: true,
	});
	await page.setViewportSize({ width: 1440, height: 1000 });
	const currentSession = await context.request.post(`${origin}/api/session`, {
		headers: { origin },
	});
	expect(currentSession.status()).toBe(204);
	expect(currentSession.headers()["cache-control"]).toBe("no-store");
	const wrongOrigin = await context.request.post(`${origin}/api/session`, {
		headers: { origin: "https://customer.example.test" },
	});
	// The app proxy rejects foreign origins before the session route.
	expect(wrongOrigin.status()).toBe(503);
	// Loss of the actual browser session removes both tools and already displayed data.
	await context.clearCookies();
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(page.locator("#organization-directory")).toHaveCount(0);
	await expect(page.locator("#organization-lookup")).toHaveCount(0);
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	await expect(
		page.getByRole("link", { name: "Organizations", exact: true }),
	).toBeVisible();
	await page.getByRole("link", { name: "Organizations", exact: true }).click();
	await expect(page.locator("#organization-directory")).toBeVisible();
	await page.getByRole("link", { name: "Staff access", exact: true }).click();
	await expect(page.locator("#organization-directory")).toHaveCount(0);
	await page.getByRole("button", { name: "Sign out" }).click();
	await expect(directory.locator("tbody tr")).toHaveCount(0);
	await expect(page.locator("#organization-directory")).toHaveCount(0);
	await expect(page.locator("#organization-lookup")).toHaveCount(0);
	await expect(page.getByLabel("Invitation code")).toBeVisible();
	await page.reload();
	await expect(page.locator("#organization-directory")).toHaveCount(0);
	const denied = await context.request.post(`${origin}/api/session`, {
		headers: { origin },
	});
	expect(denied.status()).toBe(403);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/es");
	await expect(
		page.getByRole("heading", { name: "Administración interna" }),
	).toBeVisible();
	await expect(page.getByLabel("Idioma")).toHaveValue("es");
	await expect(
		page.getByRole("heading", { name: "Directorio de organizaciones" }),
	).toHaveCount(0);
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
