import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
	type CustomerFixtureEnv,
	customerFixtureRuntime,
} from "../../packages/testing/src/example-customers/fixture";
import { auditAccessibility } from "../accessibility";

for (const { locale, mode, width } of [
	{ locale: "en", mode: "light", width: 1440 },
	{ locale: "en", mode: "dark", width: 390 },
	{ locale: "es", mode: "dark", width: 1440 },
	{ locale: "es", mode: "light", width: 390 },
] as const) {
	test(`Commercial journeys: ${locale} ${mode} ${width}px`, async ({
		page,
		baseURL,
	}, info) => {
		test.setTimeout(180_000);
		await page.setViewportSize({ width, height: 900 });
		await page.emulateMedia({ colorScheme: mode });
		for (const route of ["/account", "/help", "/about"]) {
			await page.goto(`/${locale}${route}`);
			await expect(page.getByRole("main")).toBeVisible();
			await auditAccessibility(page, info, `public-${route.slice(1)}`);
			if (route === "/help" && width === 390) {
				const example = page.locator(".help-example-scroll");
				await example.focus();
				await expect(example).toBeFocused();
				await expect(example).toHaveCSS("outline-style", "solid");
				await page.keyboard.press("ArrowRight");
				await expect
					.poll(() => example.evaluate((element) => element.scrollLeft))
					.toBeGreaterThan(0);
			}
		}
		const runtime = customerFixtureRuntime(
			process.env as CustomerFixtureEnv,
			baseURL ?? "http://localhost:3102",
		);
		try {
			const owner = await runtime.human(`a11y-${randomUUID()}@example.test`);
			const org = await runtime.tenancy.createOrganization(owner.actor, {
				name: "Accessible studio",
				slug: `a11y-${randomUUID()}`,
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
			const project = await page.request.post(
				`/api/v1/organizations/${org.id}/projects`,
				{
					headers: { origin: runtime.origin },
					data: {
						name: "Accessible project",
						slug: "accessible-project",
						operationKey: randomUUID(),
					},
				},
			);
			expect(project.ok()).toBe(true);
			for (const route of [
				"/account",
				"/account#organizations",
				"/account#security",
				"/account#sessions",
				"/account#privacy",
				...[
					"",
					"/projects",
					"/customers",
					"/billing",
					"/usage",
					"/search",
					"/keys",
					"/data",
					"/settings",
					"/privacy",
				].map((suffix) => `/organizations/${org.id}${suffix}`),
			]) {
				await page.goto(`/${locale}${route}`);
				await expect(
					page.getByRole("main").getByRole("heading", { level: 1 }),
				).toBeVisible();
				await page.waitForLoadState("networkidle");
				await auditAccessibility(
					page,
					info,
					route.split("/").at(-1) || "organization",
				);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
					`${route}: horizontal overflow`,
				).toBe(true);
			}
			await page.goto(`/${locale}/organizations/${org.id}/projects`);
			const edit = page.getByRole("button", {
				name: locale === "es" ? "Editar" : "Edit",
				exact: true,
			});
			await edit.click();
			await expect(
				page.getByRole("region", {
					name: locale === "es" ? "Archivos" : "Files",
					exact: true,
				}),
			).toBeVisible();
			await page.waitForLoadState("networkidle");
			await auditAccessibility(page, info, "project-files-edit");
			await page.locator(".projects-context summary").focus();
			await page.keyboard.press("Enter");
			const deletion = page.getByRole("button", {
				name: locale === "es" ? "Eliminar" : "Delete",
				exact: true,
			});
			await deletion.focus();
			await page.keyboard.press("Enter");
			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			await expect(
				dialog.getByRole("button", {
					name: locale === "es" ? "Cancelar" : "Cancel",
					exact: true,
				}),
			).toBeFocused();
			await auditAccessibility(page, info, "project-delete-dialog");
			await page.keyboard.press("Escape");
			await expect(dialog).not.toBeVisible();
			await expect(deletion).toBeFocused();
			await page.goto(`/${locale}/organizations/${org.id}/search`);
			const query = page.getByLabel(
				locale === "es" ? "Términos de búsqueda" : "Search terms",
			);
			await query.fill(" ");
			await page.keyboard.press("Enter");
			await expect(query).toBeFocused();
			await expect(query).toHaveAttribute("aria-invalid", "true");
			await expect(query).toHaveAttribute(
				"aria-describedby",
				"platform-query-error",
			);
			await expect(page.locator("#platform-query-error")).toHaveAttribute(
				"role",
				"alert",
			);
			await auditAccessibility(page, info, "search-invalid");
			await query.fill("Accessible");
			await page.keyboard.press("Enter");
			await expect(page.locator(".platform-results li")).toHaveCount(1);
			const activity = page.getByRole("button", {
				name: locale === "es" ? "Actividad" : "Activity",
				exact: true,
			});
			await activity.focus();
			await page.keyboard.press("Enter");
			const detail = page.getByRole("region", {
				name: "Accessible project",
				exact: true,
			});
			await expect(detail).toBeFocused();
			await auditAccessibility(page, info, "search-activity");
			await detail
				.getByRole("button", {
					name: locale === "es" ? "Cerrar actividad" : "Close activity",
				})
				.click();
			await expect(activity).toBeFocused();
			await page.goto(`/${locale}/organizations/${randomUUID()}/billing`);
			await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
			await auditAccessibility(page, info, "billing-denied");
		} finally {
			await runtime.close();
		}
	});
}
