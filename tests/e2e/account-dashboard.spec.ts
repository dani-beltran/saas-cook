import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { dashboardSignUp, emailLink } from "./dashboard-helpers";

test("an older sign-in keeps account settings available and asks for confirmation only for sessions", async ({
	page,
}, testInfo) => {
	const id = randomUUID().slice(0, 8);
	const email = `account-freshness-${id}@example.test`;
	await dashboardSignUp(page, email);
	const organizationName = `Account freshness ${id}`;
	const created = await page.request.post("/api/v1/organizations", {
		headers: { origin: new URL(page.url()).origin },
		data: {
			name: organizationName,
			slug: `account-freshness-${id}`,
			operationKey: randomUUID(),
		},
	});
	expect(created.status()).toBe(200);
	const current = await page.request.get("/api/auth/get-session");
	expect(current.status()).toBe(200);
	const { session } = await current.json();
	const connectionString = process.env.IDENTITY_DATABASE_URL;
	if (!connectionString)
		throw new Error("An isolated identity database is required");
	const identity = new Pool({ connectionString, max: 1 });
	try {
		// Age only this synthetic session beyond the real provider's freshness gate.
		const aged = await identity.query(
			"UPDATE identity.session SET created_at=now()-interval '6 minutes' WHERE id=$1",
			[session.id],
		);
		expect(aged.rowCount).toBe(1);
	} finally {
		await identity.end();
	}
	const restricted = await page.request.get("/api/auth/list-sessions");
	expect(restricted.status()).toBe(403);
	expect((await restricted.json()).code).toBe("SESSION_NOT_FRESH");

	for (const locale of ["en", "es"] as const) {
		await page.goto(`/${locale}/account#organizations`);
		await page.reload();
		const organizations = page.getByRole("tabpanel");
		await expect(
			organizations.getByRole("link", { name: new RegExp(organizationName) }),
		).toBeVisible();
		await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
		await page
			.getByRole("tab", {
				name: locale === "en" ? "Security" : "Seguridad",
				exact: true,
			})
			.click();
		await expect(page.getByRole("tabpanel")).toContainText(
			locale === "en"
				? "No passkeys added yet."
				: "Todavía no has añadido claves de acceso.",
		);
		await page
			.getByRole("tab", {
				name: locale === "en" ? "Sessions" : "Sesiones",
				exact: true,
			})
			.click();
		const sessions = page.getByRole("tabpanel");
		await expect(sessions.getByRole("status")).toContainText(
			locale === "en"
				? "Confirm your identity to view and manage your active sessions."
				: "Confirma tu identidad para ver y gestionar tus sesiones activas.",
		);
		await expect(sessions.getByRole("listitem")).toHaveCount(0);
		await page.screenshot({
			path: testInfo.outputPath(`account-sessions-confirm-${locale}.png`),
			fullPage: true,
		});
		await sessions.getByRole("link").click();
		await expect(page.locator("#reauthenticate")).toBeVisible();
	}
	await page.goto("/en/account#sessions");
	await page
		.getByRole("tabpanel")
		.getByRole("link", { name: "Confirm your identity" })
		.click();
	await page
		.locator("#reauthenticate")
		.getByRole("button", { name: "Email a sign-in link" })
		.click();
	await expect(
		page.locator("#reauthenticate").getByRole("status"),
	).toContainText("an email is on its way");
	await page.goto(await emailLink(email));
	await page.getByRole("button", { name: "Confirm", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Your account", exact: true }),
	).toBeVisible();
	await page.getByRole("tab", { name: "Sessions", exact: true }).click();
	await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(2);
	await expect(
		page
			.getByRole("tabpanel")
			.getByRole("link", { name: "Confirm your identity" }),
	).toHaveCount(0);
	await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
	await page.screenshot({
		path: testInfo.outputPath("account-settings-recovered.png"),
		fullPage: true,
	});
});

test("unexpected account loading failures remain visible and can be retried", async ({
	page,
}) => {
	await dashboardSignUp(
		page,
		`account-load-retry-${randomUUID().slice(0, 8)}@example.test`,
	);
	await page.route("**/api/auth/list-sessions", (route) =>
		route.fulfill({ status: 503, json: { error: "Identity unavailable" } }),
	);
	await page.reload();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"We could not load your account settings.",
	);
	await page.unroute("**/api/auth/list-sessions");
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await page.getByRole("tab", { name: "Sessions", exact: true }).click();
	await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(1);
	await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("account tabs show one section, support keyboard navigation and preserve drafts and deep links", async ({
	page,
}) => {
	await dashboardSignUp(
		page,
		`account-tabs-${randomUUID().slice(0, 8)}@example.test`,
	);
	for (const locale of ["en", "es"] as const) {
		await page.setViewportSize(
			locale === "en"
				? { width: 1440, height: 1000 }
				: { width: 390, height: 844 },
		);
		await page.goto(`/${locale}/account`);
		const names =
			locale === "en"
				? ["Account identity", "Organizations", "Security", "Sessions"]
				: ["Identidad de la cuenta", "Organizaciones", "Seguridad", "Sesiones"];
		const tabs = page.getByRole("tab");
		await expect(tabs).toHaveText(names);
		const expectSection = async (index: number) => {
			await expect(page.getByRole("tabpanel")).toHaveCount(1);
			await expect(
				page.getByRole("tabpanel", { name: names[index], exact: true }),
			).toBeVisible();
			await expect(page.getByRole("tab", { selected: true })).toHaveText(
				names[index],
			);
		};
		await expectSection(0);
		for (const index of [1, 2, 3, 0]) {
			await tabs.nth(index).click();
			await expectSection(index);
		}
		await tabs.first().press("ArrowLeft");
		await expectSection(3);
		await expect(tabs.last()).toBeFocused();
		await tabs.last().press("ArrowRight");
		await expectSection(0);
		await tabs.first().press("End");
		await expectSection(3);
		await tabs.last().press("Home");
		await expectSection(0);
		await tabs.first().press("ArrowRight");
		await expectSection(1);
		await expect(tabs.nth(1)).toBeFocused();
		await tabs.nth(1).press("Tab");
		await expect(page.locator("#account-organization-name")).toBeFocused();
		const organizationName = page.locator("#account-organization-name");
		await organizationName.fill("Unfinished organization");
		await tabs.nth(2).click();
		await tabs.nth(1).click();
		await expect(organizationName).toHaveValue("Unfinished organization");
		await page.reload();
		await expectSection(1);
		await page.goto(`/${locale}/account#security`);
		await expectSection(2);
		await page.goto(`/${locale}/account#sessions`);
		await expectSection(3);
		await page.goto(`/${locale}/account#reauthenticate`);
		await expectSection(2);
		await expect(page.locator("#reauthenticate")).toBeVisible();
		await page.goto(`/${locale}/account#organizations`);
		await expectSection(1);
		await page.reload();
		await expectSection(1);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
	}
});

test("organization creation retains values and its operation key after a committed response is lost", async ({
	page,
}, testInfo) => {
	const id = randomUUID().slice(0, 8);
	await dashboardSignUp(page, `account-retry-${id}@example.test`);
	await page.getByRole("tab", { name: "Organizations", exact: true }).click();
	const organizations = page.getByRole("tabpanel", {
		name: "Organizations",
		exact: true,
	});
	const form = organizations.locator("form");
	const submit = organizations.getByRole("button", {
		name: "Create organization",
		exact: true,
	});
	await submit.click();
	await expect(organizations.getByRole("alert")).toHaveCount(2);
	await organizations
		.getByLabel("Organization name", { exact: true })
		.fill(`Retry studio ${id}`);
	await organizations
		.getByLabel("URL name", { exact: true })
		.fill(`retry-studio-${id}`);

	const requests: Array<{ operationKey: string }> = [];
	let releaseResponse = () => {};
	const pendingResponse = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	await page.route("**/api/rpc/organizations/create", async (route) => {
		const body = route.request().postDataJSON();
		requests.push(body.json ?? body);
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		if (requests.length === 1) {
			await pendingResponse;
			// The real service has committed; only delivery to the browser is lost.
			await route.abort("failed");
		} else {
			await route.fulfill({ response });
		}
	});
	try {
		await submit.click();
		await expect(form).toHaveAttribute("aria-busy", "true");
		await expect(form.locator("button[type=submit]")).toBeDisabled();
		await expect.poll(() => requests.length).toBe(1);
		await form.evaluate((element) => {
			(element as HTMLFormElement).requestSubmit();
		});
		await expect(form).toHaveAttribute("aria-busy", "true");
		expect(requests).toHaveLength(1);
	} finally {
		releaseResponse();
	}
	await expect(organizations.getByRole("alert")).toContainText(
		"This action could not be completed",
	);
	await expect(
		organizations.getByLabel("Organization name", { exact: true }),
	).toHaveValue(`Retry studio ${id}`);
	await expect(
		organizations.getByLabel("URL name", { exact: true }),
	).toHaveValue(`retry-studio-${id}`);
	await page.screenshot({
		path: testInfo.outputPath("account-create-retry.png"),
		fullPage: true,
	});
	const committed = await page.request.get("/api/v1/organizations");
	expect(committed.status()).toBe(200);
	const existing = (await committed.json()).filter(
		(item: { slug: string }) => item.slug === `retry-studio-${id}`,
	);
	expect(existing).toHaveLength(1);
	await submit.click();
	await expect(page).toHaveURL(
		new RegExp(`/en/organizations/${existing[0].id}$`),
	);
	expect(requests).toHaveLength(2);
	expect(requests[0].operationKey).toBeTruthy();
	expect(requests[1].operationKey).toBe(requests[0].operationKey);
	const afterRetry = await page.request.get("/api/v1/organizations");
	expect(
		(await afterRetry.json()).filter(
			(item: { slug: string }) => item.slug === `retry-studio-${id}`,
		),
	).toHaveLength(1);
});

test("session revocation confirms consequences, keeps the current session and signs out another device", async ({
	page,
	browser,
}) => {
	const email = `account-sessions-${randomUUID().slice(0, 8)}@example.test`;
	await dashboardSignUp(page, email);
	const otherContext = await browser.newContext();
	const other = await otherContext.newPage();
	try {
		await other.goto("/en/account");
		await other.getByLabel("Email", { exact: true }).fill(email);
		await other
			.getByLabel("Password", { exact: true })
			.fill("Browser test password 2026!");
		await other.getByRole("button", { name: "Sign in", exact: true }).click();
		await expect(
			other.getByRole("heading", { name: "Your account", exact: true }),
		).toBeVisible();
		await page.reload();
		await page.getByRole("tab", { name: "Sessions", exact: true }).click();
		const sessions = page.getByRole("tabpanel", {
			name: "Sessions",
			exact: true,
		});
		await expect(sessions.getByRole("listitem")).toHaveCount(2);
		const revoke = sessions.getByRole("button", {
			name: "Sign out other sessions",
			exact: true,
		});
		page.once("dialog", async (dialog) => {
			expect(dialog.message()).toContain("This session will stay signed in");
			await dialog.dismiss();
		});
		await revoke.click();
		await expect(sessions.getByRole("listitem")).toHaveCount(2);
		await other.reload();
		await expect(
			other.getByRole("heading", { name: "Your account", exact: true }),
		).toBeVisible();
		page.once("dialog", (dialog) => dialog.accept());
		await revoke.click();
		await expect(sessions.getByRole("listitem")).toHaveCount(1);
		await expect(sessions).toContainText(
			"You are not signed in anywhere else.",
		);
		await expect(
			page.getByRole("heading", { name: "Your account", exact: true }),
		).toBeVisible();
		await other.reload();
		await expect(
			other.getByRole("heading", { name: "Welcome back", exact: true }),
		).toBeVisible();
	} finally {
		await otherContext.close();
	}
});
