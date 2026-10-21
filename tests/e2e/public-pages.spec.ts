import { expect, test } from "@playwright/test";

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
