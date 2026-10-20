import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
	type CustomerFixtureEnv,
	customerFixtureRuntime,
} from "../../packages/testing/src/example-customers/fixture";

test("data jobs, restricted audit, personal preferences and deletion preparation work with real sessions and worker", async ({
	page,
	baseURL,
}, info) => {
	test.setTimeout(90000);
	const runtime = customerFixtureRuntime(
		process.env as CustomerFixtureEnv,
		baseURL ?? "http://localhost:3102",
	);
	try {
		const owner = await runtime.human(
			`completion-${randomUUID()}@example.test`,
		);
		const org = await runtime.tenancy.createOrganization(owner.actor, {
			name: "Completion studio",
			slug: `completion-${randomUUID()}`,
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
		const created = await page.request.post(
			`/api/v1/organizations/${org.id}/projects`,
			{
				headers: { origin: runtime.origin },
				data: {
					name: "CSV source project",
					slug: "csv-source",
					operationKey: randomUUID(),
				},
			},
		);
		expect(created.ok()).toBe(true);
		await page.goto(`/en/organizations/${org.id}/projects`);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const files = page.getByRole("region", { name: "Files", exact: true });
		await files.getByLabel("Choose file").setInputFiles({
			name: "projects.csv",
			mimeType: "text/csv",
			buffer: Buffer.from("name,slug\nImported through UI,ui-imported\n"),
		});
		await files.getByRole("button", { name: "Upload and verify" }).click();
		await expect(
			files.getByRole("button", { name: "Download", exact: true }),
		).toBeVisible();
		await page.goto(`/en/organizations/${org.id}/data`);
		await page
			.getByLabel("Source project")
			.selectOption({ label: "CSV source project" });
		await page
			.getByLabel("Verified CSV file")
			.selectOption({ label: "projects.csv" });
		await page.getByRole("button", { name: "Dry run", exact: true }).click();
		await expect(
			page.getByRole("status").filter({ hasText: "row checked" }),
		).toContainText("1 row checked");
		await page
			.getByRole("button", { name: "Start import", exact: true })
			.click();
		await expect(
			page.locator(".completion-list").filter({ hasText: "projects.import" }),
		).toContainText("complete", { timeout: 25000 });
		await page
			.getByRole("button", { name: "Projects CSV", exact: true })
			.click();
		const job = page
			.locator(".completion-list li")
			.filter({ hasText: "projects.export" });
		await expect(
			job.getByRole("button", { name: "Download", exact: true }),
		).toBeVisible({ timeout: 25000 });
		const pending = page.waitForEvent("download");
		await job.getByRole("button", { name: "Download", exact: true }).click();
		const downloaded = await pending;
		expect(
			await readFile((await downloaded.path()) as string, "utf8"),
		).toContain("Imported through UI");
		await page.goto(`/en/organizations/${org.id}/settings`);
		await expect(
			page.getByRole("heading", { name: "Restricted audit log" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Grant access", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Query audit log", exact: true })
			.click();
		await expect(
			page.getByRole("table", { name: "Security events" }),
		).toBeVisible();
		await page
			.getByLabel("Allow optional analytics for this organization")
			.click();
		await expect(
			page.getByLabel("Allow optional analytics for this organization"),
		).not.toBeChecked();
		await page.goto("/en/privacy");
		await page.getByLabel("Email when data jobs finish").click();
		await expect(page.getByRole("status")).toContainText("Operation completed");
		await page.getByRole("button", { name: "Check ownership" }).click();
		await expect(page.locator("main")).toContainText(
			"Needs successor or deletion",
		);
		await expect(
			page.getByRole("button", { name: "Prepare deletion request" }),
		).toBeDisabled();
		await page.goto(`/en/organizations/${org.id}/privacy`);
		await page
			.getByRole("button", { name: "Prepare deletion request" })
			.click();
		await expect(
			page.getByRole("button", { name: "Confirm deletion", exact: true }),
		).toBeDisabled();
		await page
			.getByRole("button", { name: "Cancel request", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Prepare deletion request" }),
		).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(`/es/organizations/${org.id}/settings`);
		await expect(
			page.getByRole("heading", { name: "Configuración de la organización" }),
		).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await expect(
			page.getByLabel("Permitir analítica opcional de esta organización"),
		).toBeVisible();
		await page.screenshot({
			path: info.outputPath("completion-settings-es-mobile.png"),
			fullPage: true,
		});
		await page.goto(`/es/organizations/${org.id}/data`);
		await expect(
			page.getByRole("heading", { name: "Datos de la organización" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Proyectos CSV", exact: true }),
		).toBeVisible();
		await page.goto("/es/privacy");
		await expect(
			page.getByRole("heading", { name: "Privacidad y preferencias" }),
		).toBeVisible();
		await expect(
			page.getByLabel("Correo al terminar trabajos de datos"),
		).toBeVisible();
		await page.goto("/es/help");
		await expect(
			page.getByRole("heading", { name: "Centro de ayuda" }),
		).toBeVisible();
		await page.goto("/en/about");
		await expect(
			page.getByRole("heading", { name: "SaaS Cook", exact: true }),
		).toBeVisible();
	} finally {
		await runtime.close();
	}
});

for (const [locale, copy] of Object.entries({
	en: {
		help: "Help center",
		about: "Organization controls",
		signIn: "Sign in or create an account",
		privacy: "Open privacy",
		deletion: "Deletion status",
		check: "Check status",
		unsubscribe: "Unsubscribe from optional email",
		confirm: "Confirm unsubscribe",
		failed:
			"Could not complete. Check your access, confirm your identity, and try again.",
	},
	es: {
		help: "Centro de ayuda",
		about: "Control de la organización",
		signIn: "Entrar o crear una cuenta",
		privacy: "Abrir privacidad",
		deletion: "Estado de eliminación",
		check: "Consultar estado",
		unsubscribe: "Desactivar correo opcional",
		confirm: "Confirmar baja",
		failed:
			"No se pudo completar. Comprueba tus permisos, confirma tu identidad e inténtalo de nuevo.",
	},
})) {
	test(`${locale}: public server pages and client receipt messages use the same catalog`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (
				/MISSING_MESSAGE|INVALID_MESSAGE|FORMATTING_ERROR/.test(message.text())
			)
				errors.push(message.text());
		});
		await page.goto(`/${locale}/about`);
		await expect(page.getByRole("heading", { name: copy.about })).toBeVisible();
		await expect(page.getByRole("link", { name: copy.signIn })).toHaveAttribute(
			"href",
			`/${locale}/account`,
		);
		await page.goto(`/${locale}/help`);
		await expect(page.getByRole("heading", { name: copy.help })).toBeVisible();
		await expect(
			page.getByRole("link", { name: copy.privacy }),
		).toHaveAttribute("href", `/${locale}/privacy`);
		await page.goto(`/${locale}/deletion`);
		await expect(
			page.getByRole("heading", { name: copy.deletion }),
		).toBeVisible();
		await page.getByRole("button", { name: copy.check }).click();
		await expect(page.getByRole("status")).toHaveText(copy.failed);
		await page.goto(`/${locale}/unsubscribe`);
		await expect(
			page.getByRole("heading", { name: copy.unsubscribe }),
		).toBeVisible();
		await page.getByRole("button", { name: copy.confirm }).click();
		await expect(page.getByRole("status")).toHaveText(copy.failed);
		expect(errors).toEqual([]);
	});
}
