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
import { createElement as h } from "react";
export async function renderOptionalEmail(input: {
	locale: "en" | "es";
	url: string;
	unsubscribeUrl: string;
}) {
	const es = input.locale === "es",
		subject = es
			? "Tu tarea de datos ha terminado"
			: "Your data job has finished";
	const element = h(
		Html,
		{ lang: input.locale },
		h(Head),
		h(Preview, null, subject),
		h(
			Body,
			{ style: { fontFamily: "Arial,sans-serif" } },
			h(
				Container,
				{ style: { maxWidth: "560px", padding: "32px" } },
				h(Heading, null, subject),
				h(
					Text,
					null,
					es
						? "Abre la aplicación para comprobar el resultado con tu acceso actual."
						: "Open the application to review the result with your current access.",
				),
				h(Button, { href: input.url }, es ? "Ver tareas" : "View jobs"),
				h(
					Text,
					null,
					h(
						"a",
						{ href: input.unsubscribeUrl },
						es
							? "Desactivar correos opcionales"
							: "Unsubscribe from optional email",
					),
				),
			),
		),
	);
	return {
		subject,
		html: await render(element),
		text: await render(element, { plainText: true }),
	};
}
