import { publicConfig } from "@saas-cook/config/client";
import "../../../features/completion/completion.css";
export default async function About({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params,
		es = locale === "es";
	const config = publicConfig(process.env);
	return (
		<main className="completion-public">
			<nav>
				<a href={`/${locale}/help`}>{es ? "Ayuda" : "Help"}</a>
			</nav>
			<h1>{config.appName}</h1>
			<p>
				{es
					? "Un espacio compartido para organizar proyectos y clientes, gestionar el acceso y trabajar con tus datos."
					: "A shared workspace to organize projects and customers, manage access, and work with your data."}
			</p>
			<div className="completion-actions">
				<a href={`/${locale}/account`}>
					{es ? "Entrar o crear una cuenta" : "Sign in or create an account"}
				</a>
				<a href={`/${locale}/help`}>{es ? "Cómo funciona" : "How it works"}</a>
			</div>
			<section className="completion-card">
				<h2>{es ? "Control de la organización" : "Organization controls"}</h2>
				<p>
					{es
						? "Los permisos se comprueban para cada operación. Los propietarios pueden gestionar miembros, consultar la facturación y preparar exportaciones o solicitudes de eliminación."
						: "Permissions are checked for each operation. Owners can manage members, review billing, and prepare exports or deletion requests."}
				</p>
			</section>
			<p>
				{es
					? "Las integraciones y los servicios opcionales dependen de la configuración de cada instalación."
					: "Integrations and optional services depend on each installation’s configuration."}
			</p>
		</main>
	);
}
