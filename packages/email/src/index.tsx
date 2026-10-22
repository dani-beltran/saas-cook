import {
	Body,
	Container,
	Head,
	Heading,
	Html,
	Preview,
	Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import { publicConfig } from "@saas-cook/config/client";

const messages = {
	en: {
		title: "Your application is ready",
		body: "This is a synthetic runtime email preview.",
	},
	es: {
		title: "Tu aplicación está lista",
		body: "Esta es una vista previa de correo del entorno de prueba.",
	},
};
export type EmailLocale = keyof typeof messages;
/**
 * Render a synthetic preview without delivery side effects.
 * @param props - Explicit English/Spanish locale and optional validated product name.
 * @returns React Email markup with escaped brand text; omitted branding uses the public default.
 */
export function RuntimeEmail({
	locale,
	appName = publicConfig({}).appName,
}: {
	locale: EmailLocale;
	appName?: string;
}) {
	const message = messages[locale];
	return (
		<Html lang={locale}>
			<Head />
			<Preview>{message.title}</Preview>
			<Body
				style={{
					backgroundColor: "#f5f7fa",
					color: "#142033",
					fontFamily: "Arial, sans-serif",
				}}
			>
				<Container
					style={{
						backgroundColor: "#ffffff",
						margin: "40px auto",
						padding: "32px",
						maxWidth: "560px",
					}}
				>
					<Text>{appName}</Text>
					<Heading>{message.title}</Heading>
					<Text>{message.body}</Text>
				</Container>
			</Body>
		</Html>
	);
}
/**
 * Render localized synthetic preview HTML and text, without sending or enqueueing mail.
 * @param locale - Explicit English or Spanish catalog selection.
 * @param env - Optional APP_NAME only; no ambient credentials or locale setting is read.
 * @returns Subject, escaped HTML and matching plain text. Invalid APP_NAME throws before rendering.
 */
export async function renderRuntimeEmail(
	locale: EmailLocale,
	env: { APP_NAME?: string } = {},
) {
	const { appName } = publicConfig({ APP_NAME: env.APP_NAME });
	const element = <RuntimeEmail locale={locale} appName={appName} />;
	return {
		subject: messages[locale].title,
		html: await render(element),
		text: await render(element, { plainText: true }),
	};
}

export { deliverBillingNotices, renderBillingEmail } from "./billing";
export {
	deliverIdentityEmails,
	type EmailTransport,
	enqueueIdentityEmail,
} from "./delivery";
export { renderIdentityEmail } from "./identity";
export { renderOptionalEmail } from "./optional";
export { createSmtpTransport } from "./smtp";
