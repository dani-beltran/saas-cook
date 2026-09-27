import { expect, type Page, test } from "@playwright/test";

const password = "Synthetic authentication password 2026!";
const email = "auth-experience@example.test";

async function expectFitsViewport(page: Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
}

for (const locale of ["en", "es"] as const) {
	for (const theme of ["light", "dark"] as const) {
		test(`${locale} ${theme} authentication is responsive and localized`, async ({
			page,
		}, testInfo) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
			await page.goto(`/${locale}/account`);
			await expect(
				page.getByLabel(locale === "en" ? "Email" : "Correo electrónico", {
					exact: true,
				}),
			).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("lang", locale);
			await expect(page.locator("html")).toHaveAttribute("data-mode", "system");
			await expect(page.locator("body")).toHaveCSS(
				"background-color",
				theme === "dark" ? "rgb(17, 33, 42)" : "rgb(248, 250, 252)",
			);
			for (const viewport of [
				{ name: "desktop", width: 1440, height: 1000 },
				{ name: "mobile", width: 375, height: 812 },
			]) {
				await page.setViewportSize(viewport);
				await expectFitsViewport(page);
				await page.screenshot({
					path: testInfo.outputPath(
						`sign-in-${locale}-${theme}-${viewport.name}.png`,
					),
					fullPage: true,
				});
				await page
					.getByRole("link", {
						name: locale === "en" ? "Create an account" : "Crear una cuenta",
						exact: true,
					})
					.click();
				await expect(
					page.getByLabel(
						locale === "en" ? "Confirm password" : "Confirmar contraseña",
						{ exact: true },
					),
				).toBeVisible();
				await expectFitsViewport(page);
				await page.screenshot({
					path: testInfo.outputPath(
						`sign-up-${locale}-${theme}-${viewport.name}.png`,
					),
					fullPage: true,
				});
				await page
					.getByRole("link", {
						name: locale === "en" ? "Sign in" : "Iniciar sesión",
						exact: true,
					})
					.click();
			}
			expect(errors).toEqual([]);
		});
	}
}

test("mode changes retain email and a background session refresh preserves the form", async ({
	page,
}) => {
	let releaseRefresh = () => {};
	const pendingRefresh = new Promise<void>((resolve) => {
		releaseRefresh = resolve;
	});
	let sessionRequests = 0;
	await page.route("**/api/auth/get-session**", async (route) => {
		sessionRequests += 1;
		if (sessionRequests > 1) {
			await pendingRefresh;
		}
		await route.fulfill({ status: 200, json: null });
	});
	await page.goto("/en/account");
	await page.getByLabel("Email", { exact: true }).fill(email);
	await page
		.getByRole("link", { name: "Create an account", exact: true })
		.click();
	await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
	await page
		.getByLabel("Name", { exact: true })
		.fill("Synthetic draft account");
	await page.getByLabel("Password", { exact: true }).fill(password);
	await page.getByLabel("Confirm password", { exact: true }).fill(password);
	try {
		await page.evaluate(() =>
			document.dispatchEvent(new Event("visibilitychange")),
		);
		await expect.poll(() => sessionRequests).toBeGreaterThan(1);
		await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
			"Synthetic draft account",
		);
		await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
		await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
			password,
		);
		await expect(
			page.getByLabel("Confirm password", { exact: true }),
		).toHaveValue(password);
	} finally {
		releaseRefresh();
	}
	await page.getByRole("link", { name: "Sign in", exact: true }).click();
	for (const modeLink of [
		"Forgot password?",
		"Use an email link",
		"Recover account access",
	]) {
		await page.getByRole("link", { name: modeLink, exact: true }).click();
		await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
		await page
			.getByRole("link", { name: "Back to sign-in", exact: true })
			.click();
		await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
	}
});

test("language switching preserves the auth view and carries only an allowed mode", async ({
	page,
}) => {
	await page.goto("/en/account");
	await page
		.getByRole("link", { name: "Create an account", exact: true })
		.click();
	await page.getByLabel("Email", { exact: true }).fill(email);
	await page.getByLabel("Password", { exact: true }).fill(password);
	const spanish = page.getByRole("link", { name: "Español", exact: true });
	await expect(spanish).toHaveAttribute("href", "/es/account?mode=register");
	await spanish.click();
	await expect(
		page.getByRole("heading", { name: "Crea tu cuenta", exact: true }),
	).toBeVisible();
	await expect(
		page.getByLabel("Confirmar contraseña", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "English", exact: true }),
	).toHaveAttribute("href", "/en/account?mode=register");
	await page.goto(
		"/en/account?mode=unsupported&email=synthetic%40example.test",
	);
	await expect(
		page.getByRole("heading", { name: "Welcome back", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Español", exact: true }),
	).toHaveAttribute("href", "/es/account");
});

test("password visibility is keyboard accessible and confirmation blocks mismatched registration", async ({
	page,
}, testInfo) => {
	let registrations = 0;
	await page.route("**/api/auth/register", async (route) => {
		registrations += 1;
		await route.fulfill({ status: 200, json: { status: true } });
	});
	await page.goto("/en/account?mode=register");
	await page.getByLabel("Email", { exact: true }).fill(email);
	await page
		.getByLabel("Name", { exact: true })
		.fill("Synthetic password test");
	const firstPassword = page.getByLabel("Password", { exact: true });
	const confirmation = page.getByLabel("Confirm password", { exact: true });
	await firstPassword.fill(password);
	await expect(firstPassword).toHaveAttribute("autocomplete", "new-password");
	await expect(firstPassword).toHaveAttribute("minlength", "12");
	await expect(firstPassword).toHaveAttribute("maxlength", "128");
	await expect(firstPassword).toHaveAttribute("type", "password");
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("button", { name: "Show password", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Space");
	await expect(firstPassword).toHaveAttribute("type", "text");
	await expect(firstPassword).toHaveValue(password);
	await page
		.getByRole("button", { name: "Hide password", exact: true })
		.click();
	await expect(firstPassword).toHaveAttribute("type", "password");
	await confirmation.fill("Different synthetic password 2026!");
	await page
		.getByRole("button", { name: "Show confirm password", exact: true })
		.click();
	await expect(confirmation).toHaveAttribute("type", "text");
	await page
		.getByRole("button", { name: "Hide confirm password", exact: true })
		.click();
	await expect(confirmation).toHaveAttribute("type", "password");
	await page
		.getByRole("button", { name: "Create account", exact: true })
		.click();
	await expect(confirmation).toHaveAttribute("aria-invalid", "true");
	const mismatch = page.getByText("Passwords must match.", { exact: true });
	await expect(mismatch).toBeVisible();
	const describedBy = await confirmation.getAttribute("aria-describedby");
	expect(describedBy?.split(" ")).toContain(await mismatch.getAttribute("id"));
	expect(registrations).toBe(0);
	await page.setViewportSize({ width: 375, height: 812 });
	await page.screenshot({
		path: testInfo.outputPath("sign-up-validation-mobile.png"),
		fullPage: true,
	});
	await confirmation.fill(password);
	await page
		.getByRole("button", { name: "Create account", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText(
		"If this address is eligible",
	);
	expect(registrations).toBe(1);
	await expect(
		page.getByRole("link", { name: "Back to sign-in", exact: true }),
	).toBeVisible();
});

for (const requestMode of [
	{
		mode: "reset",
		endpoint: "request-password-reset",
		action: "Send password reset link",
	},
	{
		mode: "link",
		endpoint: "sign-in/magic-link",
		action: "Email a sign-in link",
	},
	{
		mode: "recover",
		endpoint: "request-recovery",
		action: "Send recovery link",
	},
]) {
	test(`${requestMode.mode} email request gives generic confirmation and an editable next step`, async ({
		page,
	}, testInfo) => {
		const requests: unknown[] = [];
		await page.route(`**/api/auth/${requestMode.endpoint}`, async (route) => {
			requests.push(route.request().postDataJSON());
			await route.fulfill({ status: 200, json: { status: true } });
		});
		await page.goto(`/en/account?mode=${requestMode.mode}`);
		await page.getByLabel("Email", { exact: true }).fill(email);
		await page.screenshot({
			path: testInfo.outputPath(`${requestMode.mode}-email-form.png`),
			fullPage: true,
		});
		await page
			.getByRole("button", { name: requestMode.action, exact: true })
			.click();
		await expect(page.getByRole("status")).toContainText("If this address");
		expect(requests).toEqual([
			requestMode.mode === "link"
				? { email, locale: "en", callbackURL: "/en/account" }
				: { email, locale: "en" },
		]);
		await page.screenshot({
			path: testInfo.outputPath(`${requestMode.mode}-email-success.png`),
			fullPage: true,
		});
		await page
			.getByRole("link", { name: "Try another email address", exact: true })
			.click();
		await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
		await expect(page.getByLabel("Email", { exact: true })).toBeEditable();
		await expect(
			page.getByRole("status").filter({ hasText: "If this address" }),
		).toHaveCount(0);
	});
}

test("missing-token reset and confirmation pages offer a localized way back", async ({
	page,
}, testInfo) => {
	let submissions = 0;
	await page.route("**/api/auth/{confirm,reset-password}", async (route) => {
		submissions += 1;
		await route.fulfill({ status: 400, json: { error: "Missing token" } });
	});
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	for (const path of ["reset-password", "confirm"]) {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto(`/auth/${path}?locale=es`);
		await expect(page).toHaveURL(new RegExp(`/auth/${path}$`));
		await expect(page.getByRole("main").getByRole("alert")).toContainText(
			/no (?:es|ser) válido/,
		);
		await expect(page.locator("button[type=submit]")).toHaveCount(0);
		const back = page.getByRole("link", {
			name: "Volver al acceso",
			exact: true,
		});
		await expect(back).toHaveAttribute("href", "/es/account");
		await expectFitsViewport(page);
		await page.screenshot({
			path: testInfo.outputPath(`${path}-missing-token-es-dark-mobile.png`),
			fullPage: true,
		});
	}
	expect(submissions).toBe(0);
});
