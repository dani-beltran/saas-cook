import { expect, test } from "@playwright/test";

for (const [locale, copy] of Object.entries({
	en: {
		help: "Help center",
		about: "Organization controls",
		signIn: "Sign in or create an account",
		privacy: "Open privacy",
		index: "On this page",
		backToIndex: "Back to index",
		imports: "Import projects from CSV",
		troubleshooting: "Troubleshooting",
		accessQuestion: "A page or action says access is denied.",
		accessAnswer: "First check the selected organization.",
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
		index: "En esta página",
		backToIndex: "Volver al índice",
		imports: "Importar proyectos desde CSV",
		troubleshooting: "Solución de problemas",
		accessQuestion: "Una página o acción indica que no tengo acceso.",
		accessAnswer: "Comprueba primero la organización seleccionada.",
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
	}, info) => {
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
		).toHaveAttribute("href", `/${locale}/account#privacy`);
		const index = page.getByRole("navigation", { name: copy.index });
		await expect(index.getByRole("link")).toHaveCount(12);
		for (const link of await index.getByRole("link").all()) {
			const href = await link.getAttribute("href");
			expect(href).toMatch(/^#[a-z-]+$/);
			await expect(page.locator(href as string)).toHaveCount(1);
		}
		await index.getByRole("link", { name: copy.imports, exact: true }).focus();
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/${locale}/help#imports$`));
		await expect(
			page.getByRole("heading", { name: copy.imports, exact: true }),
		).toBeFocused();
		await expect(page.locator(".help-example code")).toContainText(
			"name,slug,description",
		);
		expect(
			(await page.locator(".help-example code").innerText()).split("\n"),
		).toHaveLength(3);
		await page.screenshot({
			path: info.outputPath(`help-imports-${locale}-desktop.png`),
		});
		await index
			.getByRole("link", { name: copy.troubleshooting, exact: true })
			.click();
		const question = page
			.locator(".help-questions details")
			.filter({ hasText: copy.accessQuestion });
		await question.locator("summary").focus();
		await page.keyboard.press("Enter");
		await expect(question).toHaveAttribute("open", "");
		await expect(question.locator("p")).toContainText(copy.accessAnswer);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(`/${locale}/help`);
		await expect(index).toBeVisible();
		await page.screenshot({
			path: info.outputPath(`help-index-${locale}-mobile.png`),
		});
		await index.getByRole("link", { name: copy.imports, exact: true }).click();
		await expect(
			page.getByRole("heading", { name: copy.imports, exact: true }),
		).toBeInViewport();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: info.outputPath(`help-imports-${locale}-mobile.png`),
		});
		await page
			.getByRole("region", { name: copy.imports, exact: true })
			.getByRole("link", { name: copy.backToIndex })
			.click();
		await expect(index).toBeFocused();
		await page.setViewportSize({ width: 1280, height: 720 });
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
