import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Html,
	Preview,
	Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import { createElement } from "react";
import type { IdentityEmail } from "./delivery";

const copy = {
	en: {
		verification: "Verify your email address",
		reset: "Recover your account access",
		"magic-link": "Confirm your sign-in",
		invite: "You have an organization invitation",
		transfer: "Accept organization ownership",
		"transfer-completed": "Organization ownership transferred",
		completed:
			"Ownership has transferred from {from} to {to}. Review the organization to see current access.",
		recovery: "Your account recovery",
		action: "Continue securely",
		body: "Open the secure link below to review and confirm this action. The link expires soon. If you did not request it, you can ignore this email.",
	},
	es: {
		verification: "Verifica tu dirección de correo",
		reset: "Recupera el acceso a tu cuenta",
		"magic-link": "Confirma tu inicio de sesión",
		invite: "Tienes una invitación a una organización",
		transfer: "Acepta la propiedad de la organización",
		"transfer-completed": "Propiedad de la organización transferida",
		completed:
			"La propiedad se ha transferido de {from} a {to}. Revisa la organización para ver los accesos actuales.",
		recovery: "Recuperación de tu cuenta",
		action: "Continuar de forma segura",
		body: "Abre el enlace seguro para revisar y confirmar esta acción. El enlace caduca pronto. Si no lo has solicitado, puedes ignorar este correo.",
	},
};
export async function renderIdentityEmail(input: IdentityEmail) {
	const content = copy[input.locale];
	const subject = content[input.kind];
	const body =
		input.kind === "transfer-completed" && input.transfer
			? content.completed
					.replace("{from}", input.transfer.fromEmail)
					.replace("{to}", input.transfer.toEmail)
			: content.body;
	// Explicit React elements support both automatic and classic JSX consumers of this workspace.
	const element = createElement(
		Html,
		{ lang: input.locale },
		createElement(Head),
		createElement(Preview, null, subject),
		createElement(
			Body,
			{
				style: {
					fontFamily: "Arial,sans-serif",
					color: "#142033",
					backgroundColor: "#f5f7fa",
				},
			},
			createElement(
				Container,
				{
					style: {
						backgroundColor: "#fff",
						maxWidth: "560px",
						margin: "40px auto",
						padding: "32px",
					},
				},
				createElement(Heading, null, subject),
				createElement(Text, null, body),
				createElement(Button, { href: input.url }, content.action),
			),
		),
	);
	return {
		subject,
		html: await render(element),
		text: await render(element, { plainText: true }),
	};
}
