import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { dashboardSignUp } from "./dashboard-helpers";

test("authenticated pages: desktop/mobile, English/Spanish, light/dark and shell keyboard navigation", async ({
	page,
	baseURL,
}) => {
	test.setTimeout(120_000);
	const id = randomUUID().slice(0, 8);
	await dashboardSignUp(page, `visual-${id}@example.test`);
	const headers = { origin: baseURL ?? "" };
	const organization = await page.request.post("/api/v1/organizations", {
		headers,
		data: {
			name: "North Studio",
			slug: `north-${id}`,
			operationKey: randomUUID(),
		},
	});
	expect(organization.status()).toBe(200);
	const { id: organizationId } = await organization.json();
	const path = `/organizations/${organizationId}`;
	for (const [index, name] of [
		"Website refresh",
		"Design system",
		"Customer onboarding",
		"Launch checklist",
	].entries()) {
		const response = await page.request.post(`/api/v1${path}/projects`, {
			headers,
			data: {
				name,
				slug: `project-${index}-${id}`,
				description: [
					"A clearer home for our product and the people who use it.",
					"Shared foundations for consistent product experiences.",
					"Make the first week simple, useful and welcoming.",
					"Prepare the next release for our customers.",
				][index],
				operationKey: randomUUID(),
			},
		});
		expect(response.status()).toBe(200);
		if (index === 3) {
			const project = await response.json();
			expect(
				(
					await page.request.patch(`/api/v1${path}/projects/${project.id}`, {
						headers,
						data: { version: project.version, status: "completed" },
					})
				).status(),
			).toBe(200);
		}
	}
	await mkdir("artifacts/dashboard-redesign/screenshots", { recursive: true });
	for (const locale of ["en", "es"]) {
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(value) => localStorage.setItem("common-saas-appearance", value),
				theme,
			);
			for (const size of ["desktop", "mobile"]) {
				await page.setViewportSize(
					size === "desktop"
						? { width: 1440, height: 1000 }
						: { width: 390, height: 844 },
				);
				for (const [section, route] of [
					["account", "/account"],
					["organization", path],
					["projects", `${path}/projects`],
				]) {
					await page.goto(`/${locale}${route}`);
					await expect(page.locator(".dashboard-shell")).toBeVisible();
					await expect(page.locator(".dashboard-shell")).toHaveClass(
						theme === "dark" ? /dark/ : /^dashboard-shell$/,
					);
					await expect(
						page
							.locator("#dashboard-organization option")
							.filter({ hasText: "North Studio" }),
					).toHaveCount(1);
					if (section === "projects")
						await expect(
							page.getByRole("heading", {
								name: "Website refresh",
								exact: true,
							}),
						).toBeVisible();
					if (section === "organization")
						await expect(
							page.getByRole("heading", { name: "North Studio", exact: true }),
						).toBeVisible();
					await expect(page.getByRole("main")).toBeVisible();
					expect(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
					).toBe(true);
					await page.screenshot({
						path: `artifacts/dashboard-redesign/screenshots/${section}-${locale}-${theme}-${size}.png`,
						fullPage: true,
						animations: "disabled",
					});
				}
			}
		}
	}
	await page.goto(`/en${path}/projects`);
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("link", { name: "Skip to content", exact: true }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("main")).toBeFocused();
	const menu = page.getByRole("button", {
		name: "Toggle navigation",
		exact: true,
	});
	await menu.focus();
	await page.keyboard.press("Enter");
	await expect(menu).toHaveAttribute("aria-expanded", "true");
	await page.getByLabel("Language", { exact: true }).selectOption("es");
	await expect(page).toHaveURL(
		new RegExp(`/es${path}/projects#dashboard-content$`),
	);
	await page
		.getByRole("button", { name: "Mostrar u ocultar navegación", exact: true })
		.click();
	await page.getByLabel("Idioma", { exact: true }).focus();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", {
			name: "Mostrar u ocultar navegación",
			exact: true,
		}),
	).toBeFocused();
});
