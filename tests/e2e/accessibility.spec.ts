import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import {
	type CustomerFixtureEnv,
	customerFixtureRuntime,
} from "../../packages/testing/src/example-customers/fixture";
import { auditAccessibility } from "../accessibility";

// Positive state assertions keep loading, failed requests or the wrong account tab
// from satisfying a ready-state audit merely because its page heading rendered.
async function expectReadyRoute(
	page: Page,
	route: string,
	locale: "en" | "es",
) {
	const main = page.getByRole("main");
	if (route.startsWith("/account")) {
		const section = route.split("#")[1] ?? "identity";
		await expect(main.locator(`#account-tab-${section}`)).toHaveAttribute(
			"aria-selected",
			"true",
		);
		const panel = main.locator(`#${section}[role="tabpanel"]`);
		await expect(panel).toBeVisible();
		await expect(
			main.locator('.account-dashboard > p[role="status"]'),
		).toHaveCount(0);
		if (section === "identity") {
			await expect(panel.locator(".account-identity-row")).toBeVisible();
			await expect(panel.getByRole("radio").first()).toBeEnabled();
		} else if (section === "organizations") {
			await expect(
				panel.getByRole("link", { name: /Accessible studio/ }),
			).toBeVisible();
		} else if (section === "sessions") {
			await expect(panel.locator(".account-session-list > li")).toHaveCount(1);
		} else if (section === "privacy") {
			await expect(panel.locator("#notification-email")).toBeVisible();
			await expect(panel.locator("#notification-in-app")).toBeVisible();
			await expect(panel.locator("#privacy-analytics")).toBeVisible();
		}
	} else {
		switch (route.split("/").at(-1)) {
			case "projects":
				await expect(
					main.getByRole("heading", {
						name: "Accessible project",
						exact: true,
					}),
				).toBeVisible();
				break;
			case "customers":
				await expect(
					main.getByRole("heading", {
						name:
							locale === "es"
								? "Empieza tu directorio de clientes"
								: "Start your customer directory",
						exact: true,
					}),
				).toBeVisible();
				break;
			case "billing":
			case "usage":
				await expect(main.locator(".billing-usage .billing-value")).toHaveText(
					"1 / 1000",
				);
				break;
			case "search":
				await expect(main.locator("#platform-query")).toBeEditable();
				break;
			case "keys":
				await expect(
					main.getByText(
						locale === "es"
							? "Aún no hay cuentas de servicio."
							: "No service accounts yet.",
						{ exact: true },
					),
				).toBeVisible();
				break;
			case "data":
				await expect(
					main.getByText(
						locale === "es" ? "No hay trabajos." : "No jobs yet.",
						{
							exact: true,
						},
					),
				).toBeVisible();
				await expect(main.locator("#data-field-1 option")).toHaveText([
					locale === "es" ? "Seleccionar" : "Select",
					"Accessible project",
				]);
				break;
			case "settings":
				await expect(main.getByRole("checkbox")).toBeVisible();
				break;
			case "privacy":
				await expect(main.locator("#privacy-deletion-title")).toBeVisible();
				await expect(
					main.getByRole("link", {
						name: locale === "en" ? "Export data" : "Exportar datos",
						exact: true,
					}),
				).toHaveAttribute(
					"href",
					`/${locale}${route.replace(/\/privacy$/, "/data")}`,
				);
				break;
			default:
				await expect(main.locator("#org-tab-members")).toHaveAttribute(
					"aria-selected",
					"true",
				);
				await expect(main.locator("#org-panel-members")).toBeVisible();
				await expect(
					main.getByRole("heading", { name: "Accessible studio", exact: true }),
				).toBeVisible();
		}
	}
	await expect(main.getByRole("alert")).toHaveCount(0);
	await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);
}

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
			if (route === "/account")
				await expect(page.locator("#sign-in-password")).toBeVisible();
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
				await expectReadyRoute(page, route, locale);
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
			await expect(
				page
					.getByRole("region", {
						name: locale === "es" ? "Archivos" : "Files",
						exact: true,
					})
					.getByText(locale === "es" ? "No hay archivos" : "No files", {
						exact: true,
					}),
			).toBeVisible();
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
			await expect(detail.locator(".platform-activity ol")).toBeAttached();
			await expect(detail.getByRole("alert")).toHaveCount(0);
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
