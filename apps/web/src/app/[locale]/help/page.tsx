import "../../../features/completion/completion.css";
export default async function Help({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params,
		es = locale === "es";
	return (
		<main className="completion-public">
			<nav>
				<a href={`/${locale}/account`}>
					{es ? "Volver a la aplicación" : "Back to application"}
				</a>
			</nav>
			<h1>{es ? "Centro de ayuda" : "Help center"}</h1>
			<section className="completion-card">
				<h2>{es ? "Datos y archivos" : "Data and files"}</h2>
				<p>
					{es
						? "En un proyecto, sube texto UTF-8 o CSV de hasta 1 MiB. Finaliza la verificación antes de usarlo. En Datos, asigna las columnas, valida sin importar y revisa los errores por fila. Los trabajos admiten hasta 1000 filas; puedes cancelar o reintentar con tus permisos actuales."
						: "In a project, upload UTF-8 text or CSV up to 1 MiB. Finish verification before using it. In Data, map columns, run validation, and review row errors. Jobs support up to 1,000 rows; you can cancel or retry with current access."}
				</p>
				<p>
					{es
						? "Las exportaciones caducan a las 24 horas. Si cambian tus permisos o los datos de origen, genera una nueva exportación."
						: "Exports expire after 24 hours. If your permissions or source data change, generate a new export."}
				</p>
			</section>
			<section className="completion-card">
				<h2>{es ? "Cuenta y privacidad" : "Account and privacy"}</h2>
				<p>
					{es
						? "En Privacidad puedes cambiar las notificaciones y la analítica opcional. Antes de eliminar tu cuenta, transfiere las organizaciones de las que seas el único propietario. Una solicitud preparada se puede cancelar; una eliminación confirmada revoca el acceso y no se puede deshacer."
						: "In Privacy you can change optional notifications and analytics. Before deleting your account, transfer organizations where you are the sole owner. A prepared request can be canceled; confirmed deletion revokes access and cannot be undone."}
				</p>
				<a href={`/${locale}/privacy`}>
					{es ? "Abrir privacidad" : "Open privacy"}
				</a>
			</section>
			<section className="completion-card">
				<h2>{es ? "Integraciones y auditoría" : "Integrations and audit"}</h2>
				<p>
					{es
						? "Los propietarios y administradores pueden configurar destinos HTTPS autorizados. Verifica los webhooks antes de usarlos y guarda sus secretos al crearlos o rotarlos. La auditoría necesita un permiso adicional concedido por un propietario."
						: "Owners and administrators can configure approved HTTPS destinations. Verify webhooks before use and save secrets when created or rotated. Audit access requires an additional permission granted by an owner."}
				</p>
			</section>
			<section className="completion-card">
				<h2>{es ? "Acceso bloqueado" : "Access blocked"}</h2>
				<p>
					{es
						? "Confirma tu identidad para cambios sensibles. Si una organización necesita recuperación de propietario, contacta con el administrador de tu instalación. La recuperación requiere verificación independiente; no compartas contraseñas ni códigos de recuperación."
						: "Confirm your identity for sensitive changes. If an organization needs owner recovery, contact your installation administrator. Recovery requires independent verification; do not share passwords or recovery codes."}
				</p>
			</section>
		</main>
	);
}
