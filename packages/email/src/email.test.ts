import { expect, it } from "vitest";
import { renderIdentityEmail, renderRuntimeEmail } from "./index";

it("renders localized, credential-free React Email HTML and plaintext", async () => {
	const english = await renderRuntimeEmail("en");
	const spanish = await renderRuntimeEmail("es");
	expect(english.html).toContain('lang="en"');
	expect(spanish.html).toContain('lang="es"');
	expect(english.text.toLowerCase()).toContain("your application is ready");
	expect(spanish.text.toLowerCase()).toContain("tu aplicación está lista");
	expect(english.subject).not.toBe(spanish.subject);
	expect(english.html).not.toContain("localhost");
});

it.each([
	["verification", "Verifica tu dirección de correo"],
	["reset", "Recupera el acceso a tu cuenta"],
	["magic-link", "Confirma tu inicio de sesión"],
	["invite", "Tienes una invitación a una organización"],
	["transfer", "Acepta la propiedad de la organización"],
	["transfer-completed", "Propiedad de la organización transferida"],
	["recovery", "Recuperación de tu cuenta"],
] as const)(
	"renders the Spanish %s identity journey in HTML and plaintext",
	async (kind, subject) => {
		const url = "https://auth.example.test/auth/confirm?token=synthetic-token";
		const message = await renderIdentityEmail({
			kind,
			locale: "es",
			to: "recipient@example.test",
			url,
			transfer: {
				fromEmail: "previous@example.test",
				toEmail: "next@example.test",
			},
		});
		expect(message.subject).toBe(subject);
		expect(message.html).toContain('lang="es"');
		expect(message.text.toLocaleLowerCase("es")).toContain(
			subject.toLocaleLowerCase("es"),
		);
		expect(message.text).toContain("Continuar de forma segura");
		expect(message.text).toContain(url);
		if (kind === "transfer-completed") {
			expect(message.text).toContain(
				"La propiedad se ha transferido de previous@example.test a next@example.test",
			);
			expect(message.text).not.toContain("{from}");
		} else expect(message.text).toContain("Abre el enlace seguro");
	},
);
