import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { dashboardSignUp } from "./dashboard-helpers";

test("localized Foundation billing and usage show real Project consumption and reject cross-tenant access", async ({
	page,
	baseURL,
}) => {
	test.setTimeout(120000);
	const suffix = randomUUID().slice(0, 8);
	await dashboardSignUp(page, `billing-${suffix}@example.test`);
	const headers = { origin: baseURL ?? "" };
	const response = await page.request.post("/api/v1/organizations", {
		headers,
		data: {
			name: "Billing test",
			slug: `billing-${suffix}`,
			operationKey: randomUUID(),
		},
	});
	expect(response.status()).toBe(200);
	const { id } = await response.json();
	await page.goto(`/en/organizations/${id}/billing`);
	await expect(
		page.getByRole("heading", { name: "Billing", exact: true }),
	).toBeVisible();
	await expect(page.getByText("No invoices yet.")).toBeVisible();
	await expect(
		page.getByText(
			"Local authorization, seat admission and usage quotas are active. Hosted billing is not enabled.",
		),
	).toBeVisible();
	const input = {
		name: "Usage test",
		slug: `usage-${suffix}`,
		operationKey: randomUUID(),
	};
	expect(
		(
			await page.request.post(`/api/v1/organizations/${id}/projects`, {
				headers,
				data: input,
			})
		).status(),
	).toBe(200);
	expect(
		(
			await page.request.post(`/api/v1/organizations/${id}/projects`, {
				headers,
				data: input,
			})
		).status(),
	).toBe(200);
	await page.getByRole("link", { name: "Usage", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Usage", exact: true }).first(),
	).toBeVisible();
	await expect(page.getByText("1 / 1000", { exact: true })).toBeVisible();
	await page.goto(`/es/organizations/${id}/billing`);
	await expect(
		page.getByRole("heading", { name: "Facturación", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Aún no hay facturas.")).toBeVisible();
	await page.getByRole("button", { name: "Actualizar", exact: true }).focus();
	await expect(
		page.getByRole("button", { name: "Actualizar", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByText("1 / 1000", { exact: true })).toBeVisible();
	await page.goto(`/en/organizations/${randomUUID()}/billing`);
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"Only an active owner or billing manager",
	);
});
