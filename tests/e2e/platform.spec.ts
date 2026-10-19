import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
	type CustomerFixtureEnv,
	customerFixtureRuntime,
} from "../../packages/testing/src/example-customers/fixture";

test("search and activity use real sessions, isolate tenants, support keyboard and Spanish mobile", async ({
	page,
	baseURL,
}, info) => {
	const runtime = customerFixtureRuntime(
		process.env as CustomerFixtureEnv,
		baseURL ?? "http://localhost:3102",
	);
	try {
		const owner = await runtime.human(`platform-${randomUUID()}@example.test`);
		const org = await runtime.tenancy.createOrganization(owner.actor, {
			name: "Discovery studio",
			slug: `discovery-${randomUUID()}`,
			operationKey: randomUUID(),
		});
		const other = await runtime.tenancy.createOrganization(owner.actor, {
			name: "Other studio",
			slug: `other-${randomUUID()}`,
			operationKey: randomUUID(),
		});
		const customer = await runtime.exampleCustomers.create(
			owner.actor,
			org.id,
			{
				name: "Atlas customer",
				email: "not-in-search@example.test",
				operationKey: randomUUID(),
			},
		);
		await runtime.exampleCustomers.create(owner.actor, other.id, {
			name: "Atlas foreign",
			email: "foreign@example.test",
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
		const response = await page.request.post(
			`/api/v1/organizations/${org.id}/projects`,
			{
				headers: { origin: runtime.origin },
				data: {
					name: "Atlas project",
					slug: "atlas",
					operationKey: randomUUID(),
				},
			},
		);
		expect(response.ok()).toBe(true);
		await page.goto(`/en/organizations/${org.id}/search`);
		await expect(
			page.getByRole("heading", { name: "Search", exact: true }),
		).toBeVisible();
		await page.getByLabel("Search terms").fill("Atlas");
		await page.keyboard.press("Enter");
		await expect(page.locator(".platform-results li")).toHaveCount(2);
		await expect(page.locator(".platform-results")).not.toContainText(
			"Atlas foreign",
		);
		await expect(page.locator("main")).not.toContainText("not-in-search@");
		await page
			.locator(".platform-results li")
			.filter({ hasText: "Atlas project" })
			.getByRole("button", { name: "Activity" })
			.focus();
		await page.keyboard.press("Enter");
		await expect(page.getByRole("region", { name: "Activity" })).toContainText(
			"Created",
		);
		await page.screenshot({
			path: info.outputPath("platform-desktop.png"),
			fullPage: true,
		});
		await runtime.exampleCustomers.delete(owner.actor, org.id, {
			id: customer.id,
			version: customer.version,
			operationKey: randomUUID(),
		});
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await expect(page.locator(".platform-results li")).toHaveCount(1);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(`/es/organizations/${org.id}/search`);
		await page.getByLabel("Términos de búsqueda").fill("Atlas");
		await page.keyboard.press("Enter");
		await expect(page.locator(".platform-results li")).toHaveCount(1);
		await page.getByRole("button", { name: "Actividad", exact: true }).click();
		await expect(page.getByRole("region", { name: "Actividad" })).toContainText(
			"Creado",
		);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: info.outputPath("platform-mobile-es.png"),
			fullPage: true,
		});
	} finally {
		await runtime.close();
	}
});

test("API-key administration issues once, lists metadata, rotates and revokes a working key", async ({
	page,
	baseURL,
}) => {
	const runtime = customerFixtureRuntime(
		process.env as CustomerFixtureEnv,
		baseURL ?? "http://localhost:3102",
	);
	try {
		const owner = await runtime.human(`keys-${randomUUID()}@example.test`);
		const org = await runtime.tenancy.createOrganization(owner.actor, {
			name: "Keys studio",
			slug: `keys-${randomUUID()}`,
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
		await page.goto(`/en/organizations/${org.id}/keys`);
		await page.getByLabel("Service account name").fill("Automation");
		await page
			.getByRole("checkbox", {
				name: "Allow reading every project in this organization",
			})
			.check();
		await page
			.getByRole("button", { name: "Create service account", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Automation", exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Issue key", exact: true }).click();
		const secretInput = page.getByRole("textbox", {
			name: "Copy this secret now. It will not be shown again.",
		});
		await expect(secretInput).toBeVisible();
		const secret = await secretInput.inputValue();
		expect(secret).toMatch(/^cs_/);
		const call = async (token: string) =>
			page.request.get(`/api/v1/organizations/${org.id}/projects`, {
				headers: { authorization: `Bearer ${token}` },
			});
		expect((await call(secret)).ok()).toBe(true);
		await page
			.getByRole("button", { name: "I have saved this secret" })
			.click();
		await expect(secretInput).toHaveCount(0);
		await page.getByRole("button", { name: "Rotate key", exact: true }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm", exact: true })
			.click();
		await expect(secretInput).toBeVisible();
		const replacement = await secretInput.inputValue();
		expect(replacement).not.toBe(secret);
		expect((await call(secret)).ok()).toBe(false);
		expect((await call(replacement)).ok()).toBe(true);
		await page
			.getByRole("button", { name: "I have saved this secret" })
			.click();
		await page.getByRole("button", { name: "Revoke key", exact: true }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Revoke key", exact: true }),
		).toHaveCount(0);
		expect((await call(replacement)).ok()).toBe(false);
		await page.reload();
		await expect(
			page.getByRole("textbox", {
				name: "Copy this secret now. It will not be shown again.",
			}),
		).toHaveCount(0);
	} finally {
		await runtime.close();
	}
});
