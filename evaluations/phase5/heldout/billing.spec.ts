import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { dashboardSignUp } from "./dashboard-helpers";

test("phase5 usage copy, keyboard, denied, pending, outage and conflict states", async ({
	page,
	baseURL,
}) => {
	test.setTimeout(120000);
	await dashboardSignUp(page, `phase5-hidden-${randomUUID()}@example.test`);
	const response = await page.request.post("/api/v1/organizations", {
		headers: { origin: baseURL ?? "" },
		data: {
			name: "Hidden billing",
			slug: `hidden-${randomUUID()}`,
			operationKey: randomUUID(),
		},
	});
	expect(response.status()).toBe(200);
	const { id } = await response.json();
	await page.goto(`/en/organizations/${id}/usage`);
	await expect(
		page.getByText("Usage resets at the start of each UTC calendar month.", {
			exact: true,
		}),
	).toBeVisible();
	await expect(
		page.getByText("Billing support: billing-help@example.test", {
			exact: true,
		}),
	).toBeVisible();
	const refresh = page.getByRole("button", { name: "Refresh", exact: true });
	await refresh.focus();
	await expect(refresh).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(
		page.getByText("Usage resets at the start of each UTC calendar month.", {
			exact: true,
		}),
	).toBeVisible();
	await page.goto(`/es/organizations/${id}/usage`);
	await expect(
		page.getByText("El uso se reinicia al comienzo de cada mes natural UTC.", {
			exact: true,
		}),
	).toBeVisible();
	await page.goto(`/en/organizations/${randomUUID()}/billing`);
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"Only an active owner or billing manager",
	);
	let mode = "pending";
	await page.route("**/api/rpc/billing/get**", async (route) => {
		if (mode === "conflict") {
			await route.fulfill({
				status: 409,
				contentType: "application/json",
				body: JSON.stringify({
					json: {
						defined: false,
						code: "CONFLICT",
						status: 409,
						message: "stale",
					},
				}),
			});
			return;
		}
		const real = await route.fetch(),
			envelope = await real.json();
		const snapshot = envelope.json ?? envelope;
		expect(snapshot).toHaveProperty("usage");
		snapshot.enabled = true;
		snapshot.health = mode === "outage" ? "outage" : "healthy";
		snapshot.commands =
			mode === "pending"
				? [
						{
							id: randomUUID(),
							kind: "checkout",
							state: "pending",
							url: null,
							createdAt: new Date().toISOString(),
						},
					]
				: [];
		await route.fulfill({ response: real, json: envelope });
	});
	await page.goto(`/en/organizations/${id}/billing`);
	await expect(
		page
			.getByRole("status")
			.filter({ hasText: "Your request is saved and awaiting confirmation." }),
	).toBeVisible();
	mode = "outage";
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(
		page.getByText("Provider outage", { exact: true }),
	).toBeVisible();
	mode = "conflict";
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"This change is stale or another billing command is pending.",
	);
});
