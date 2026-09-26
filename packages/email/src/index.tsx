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

const messages = {
	en: {
		title: "Your application is ready",
		body: "This is a synthetic runtime email preview. Identity email journeys arrive in Phase 2.",
	},
	es: {
		title: "Tu aplicación está lista",
		body: "Esta es una vista previa de correo del entorno de prueba. Los flujos de identidad llegarán en la fase 2.",
	},
};
export type EmailLocale = keyof typeof messages;
export function RuntimeEmail({ locale }: { locale: EmailLocale }) {
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
					<Heading>{message.title}</Heading>
					<Text>{message.body}</Text>
				</Container>
			</Body>
		</Html>
	);
}
export async function renderRuntimeEmail(locale: EmailLocale) {
	const element = <RuntimeEmail locale={locale} />;
	return {
		subject: messages[locale].title,
		html: await render(element),
		text: await render(element, { plainText: true }),
	};
}
