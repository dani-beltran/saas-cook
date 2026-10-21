import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
	type CustomerFixtureEnv,
	customerFixtureRuntime,
} from "../../packages/testing/src/example-customers/fixture";

test("privacy settings recover from loading failures, persist preferences and guide safe deletion", async ({
	page,
	baseURL,
}, info) => {
	const runtime = customerFixtureRuntime(
		process.env as CustomerFixtureEnv,
		baseURL ?? "http://localhost:3102",
	);
	try {
		const owner = await runtime.human(`privacy-${randomUUID()}@example.test`);
		const org = await runtime.tenancy.createOrganization(owner.actor, {
			name: "Privacy studio",
			slug: `privacy-${randomUUID()}`,
			operationKey: randomUUID(),
		});
		await page.context().addCookies(
			owner.cookie.split("; ").map((item) => {
				const i = item.indexOf("=");
				return {
					name: item.slice(0, i),
					value: item.slice(i + 1),
					url: runtime.origin,
				};
			}),
		);
		await page.route(
			"**/api/rpc/notifications/preferences**",
			(route) => route.fulfill({ status: 503, body: "Unavailable" }),
			{ times: 1 },
		);
		await page.route(
			"**/api/rpc/analytics/preferences**",
			(route) => route.fulfill({ status: 503, body: "Unavailable" }),
			{ times: 1 },
		);
		await page.goto("/en/privacy");
		await expect(page).toHaveURL(/\/en\/account#privacy$/);
		await expect(
			page.getByRole("tab", { name: "Privacy", selected: true }),
		).toBeVisible();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Your account",
		);
		const notifications = page.getByRole("region", {
			name: "Optional notifications",
			exact: true,
		});
		const analytics = page.getByRole("region", {
			name: "Product analytics",
			exact: true,
		});
		await expect(
			notifications
				.getByRole("status")
				.filter({ hasText: "could not be loaded" }),
		).toBeVisible();
		await notifications.getByRole("button", { name: "Try again" }).click();
		await analytics.getByRole("button", { name: "Try again" }).click();
		const email = notifications.getByRole("checkbox", {
			name: "Email when data jobs finish",
			exact: true,
		});
		const initialEmail = await email.isChecked();
		await email.focus();
		await page.keyboard.press("Space");
		await expect(email).toBeChecked({ checked: !initialEmail });
		await expect(notifications.getByRole("status")).toContainText(
			"Operation completed",
		);
		const analyticsChoice = analytics.getByRole("checkbox", {
			name: "Allow optional product analytics",
			exact: true,
		});
		const initialAnalytics = await analyticsChoice.isChecked();
		await analyticsChoice.click();
		await expect(analyticsChoice).toBeChecked({ checked: !initialAnalytics });
		await expect(analytics.getByRole("status")).toContainText(
			"Operation completed",
		);
		await page.reload();
		await expect(email).toBeChecked({ checked: !initialEmail });
		await expect(analyticsChoice).toBeChecked({ checked: !initialAnalytics });
		const exported = page.waitForEvent("download");
		await page.getByRole("button", { name: "Export my account data" }).click();
		expect((await exported).suggestedFilename()).toBeTruthy();
		const deletion = page.getByRole("region", {
			name: "Delete my account",
			exact: true,
		});
		const prepare = deletion.getByRole("button", {
			name: "Prepare deletion request",
		});
		await expect(prepare).toBeDisabled();
		await expect(
			deletion.getByRole("link", {
				name: "Confirm your identity before continuing",
			}),
		).toHaveAttribute("href", "/en/account#reauthenticate");
		await deletion.getByRole("button", { name: "Check ownership" }).focus();
		await page.keyboard.press("Enter");
		await expect(deletion).toContainText("Needs successor or deletion");
		await expect(prepare).toBeDisabled();
		await page.getByRole("tab", { name: "Security", exact: true }).click();
		await page.getByRole("tab", { name: "Privacy", exact: true }).click();
		await expect(deletion).toContainText("Needs successor or deletion");
		await page.evaluate(() => window.scrollTo(0, 0));
		await page.screenshot({
			path: info.outputPath("privacy-account-desktop.png"),
			fullPage: true,
		});
		await page.goto(`/en/organizations/${org.id}/privacy`);
		await page
			.getByRole("button", { name: "Prepare deletion request" })
			.click();
		const confirmation = page.getByRole("region", {
			name: "Review your deletion request",
		});
		await expect(confirmation).toBeFocused();
		const confirm = confirmation.getByRole("button", {
			name: "Confirm deletion",
			exact: true,
		});
		await expect(confirm).toBeDisabled();
		await confirmation.getByRole("checkbox").click();
		await expect(confirm).toBeEnabled();
		await confirmation.getByRole("button", { name: "Cancel request" }).click();
		await expect(
			page.getByRole("button", { name: "Prepare deletion request" }),
		).toBeFocused();
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(`/es/organizations/${org.id}/privacy`);
		await expect(
			page.getByRole("link", { name: "Exportar datos" }),
		).toHaveAttribute("href", `/es/organizations/${org.id}/data`);
		await page
			.getByRole("button", { name: "Preparar solicitud de eliminación" })
			.click();
		await expect(
			page.getByRole("region", { name: "Revisa tu solicitud de eliminación" }),
		).toBeFocused();
		await expect(
			page.getByRole("button", { name: "Confirmar eliminación", exact: true }),
		).toBeDisabled();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.evaluate(() => window.scrollTo(0, 0));
		await page.screenshot({
			path: info.outputPath("privacy-confirmation-mobile-es.png"),
			fullPage: true,
		});
		await page.getByRole("button", { name: "Cancelar solicitud" }).click();
	} finally {
		await runtime.close();
	}
});
