import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { dashboardSignUp } from "./dashboard-helpers";

test("organization creation retains values and its operation key after a committed response is lost", async ({
	page,
}, testInfo) => {
	const id = randomUUID().slice(0, 8);
	await dashboardSignUp(page, `account-retry-${id}@example.test`);
	const organizations = page.getByRole("region", {
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
		const sessions = page.getByRole("region", {
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
