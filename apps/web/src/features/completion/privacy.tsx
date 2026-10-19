"use client";
import { Button } from "@saas-cook/ui";
import { useEffect, useState } from "react";
import { DashboardShell } from "../../components/dashboard-shell";
import { api, download, Status, useOperation } from "./common";

type Client = ReturnType<typeof api>["completion"];
export function PrivacyPage({ organizationId }: { organizationId?: string }) {
	const op = useOperation(),
		{ es } = op;
	const [obligations, setObligations] =
			useState<Awaited<ReturnType<Client["deletionPreview"]>>>(),
		[request, setRequest] =
			useState<Awaited<ReturnType<Client["deletionRequest"]>>>(),
		[consent, setConsent] = useState(false),
		[preferences, setPreferences] =
			useState<Awaited<ReturnType<Client["notificationPreferences"]>>>(),
		[analytics, setAnalytics] =
			useState<Awaited<ReturnType<Client["analyticsGet"]>>>();
	useEffect(() => {
		let active = true;
		if (!organizationId)
			void Promise.all([
				api().completion.notificationPreferences({}),
				api().completion.analyticsGet({ organizationId: null }),
			])
				.then(([p, a]) => {
					if (active) {
						setPreferences(p);
						setAnalytics(a);
					}
				})
				.catch(() => {});
		return () => {
			active = false;
		};
	}, [organizationId]);

	return (
		<DashboardShell section="privacy" organizationId={organizationId}>
			<header className="dashboard-page-header">
				<h1>{es ? "Privacidad y preferencias" : "Privacy and preferences"}</h1>
			</header>
			<Status {...op} />
			{!organizationId && (
				<section className="completion-card">
					<Button
						disabled={op.busy}
						onClick={() =>
							void op.run(async () =>
								download(await api().completion.personalExport({})),
							)
						}
					>
						{es ? "Exportar mis datos" : "Export my account data"}
					</Button>
					<h2>{es ? "Notificaciones opcionales" : "Optional notifications"}</h2>
					{preferences && (
						<>
							<label className="completion-check">
								<input
									type="checkbox"
									checked={preferences.email}
									disabled={op.busy || preferences.suppressed}
									onChange={(e) =>
										void op.run(async () => {
											await api().completion.notificationSave({
												email: e.target.checked,
												inApp: preferences.inApp,
												locale: es ? "es" : "en",
												version: preferences.version,
											});
											setPreferences(
												await api().completion.notificationPreferences({}),
											);
										})
									}
								/>
								{es
									? "Correo al terminar trabajos de datos"
									: "Email when data jobs finish"}
							</label>
							<label className="completion-check">
								<input
									type="checkbox"
									checked={preferences.inApp}
									disabled={op.busy}
									onChange={(e) =>
										void op.run(async () => {
											await api().completion.notificationSave({
												email: preferences.email,
												inApp: e.target.checked,
												locale: es ? "es" : "en",
												version: preferences.version,
											});
											setPreferences(
												await api().completion.notificationPreferences({}),
											);
										})
									}
								/>
								{es
									? "Notificaciones en la aplicación"
									: "In-app notifications"}
							</label>
							{preferences.suppressed && (
								<p>
									{es
										? "El correo opcional está suprimido por una baja, rebote o queja."
										: "Optional email is suppressed after an unsubscribe, bounce, or complaint."}
								</p>
							)}
						</>
					)}
					<p>
						{es
							? "Los avisos obligatorios de seguridad y facturación siguen sus propias reglas."
							: "Mandatory security and billing notices follow their own rules."}
					</p>
					{analytics && (
						<label className="completion-check">
							<input
								type="checkbox"
								disabled={op.busy}
								checked={analytics.enabled}
								onChange={(e) =>
									void op.run(async () =>
										setAnalytics(
											await api().completion.analyticsSet({
												organizationId: null,
												enabled: e.target.checked,
												version: analytics.version,
											}),
										),
									)
								}
							/>
							{es
								? "Permitir analítica opcional del producto"
								: "Allow optional product analytics"}
						</label>
					)}
				</section>
			)}
			<section className="completion-card">
				<h2>
					{organizationId
						? es
							? "Eliminar organización"
							: "Delete organization"
						: es
							? "Eliminar mi cuenta"
							: "Delete my account"}
				</h2>
				<p>
					{organizationId
						? es
							? "Se suspende la organización y se eliminan sus datos. La cancelación de la suscripción se confirma con el proveedor; puede quedar pendiente hasta el final del periodo contratado. Exporta primero los datos que necesites."
							: "The organization is suspended and its data is deleted. Subscription cancellation is confirmed with the provider; it may remain pending until the contracted period ends. Export the data you need first."
						: es
							? "Antes de eliminar tu cuenta, cada organización de la que seas el único propietario debe tener un sucesor verificado o completar su eliminación. Las organizaciones compartidas y sus suscripciones se conservan."
							: "Before deleting your account, each organization where you are the sole owner must have a verified successor or complete deletion. Shared organizations and their subscriptions are preserved."}
				</p>
				<p>
					{es
						? "Se conservan registros restringidos de seguridad y financieros. Las copias de seguridad caducan según la política de almacenamiento; el estado no certifica su eliminación."
						: "Restricted security and financial records are retained. Backups expire under the storage policy; this status does not certify their erasure."}
				</p>
				<p>
					<a href="/auth/confirm">
						{es
							? "Confirma tu identidad antes de continuar"
							: "Confirm your identity before continuing"}
					</a>
				</p>
				{organizationId && (
					<a href={`../${organizationId}/data`}>
						{es ? "Exportar datos" : "Export data"}
					</a>
				)}
				{!organizationId && (
					<Button
						disabled={op.busy}
						variant="secondary"
						onClick={() =>
							void op.run(async () =>
								setObligations(await api().completion.deletionPreview({})),
							)
						}
					>
						{es ? "Comprobar propiedad" : "Check ownership"}
					</Button>
				)}
				{obligations && (
					<ul>
						{obligations.map((o) => (
							<li key={o.organizationId}>
								<a
									href={`/${es ? "es" : "en"}/organizations/${o.organizationId}`}
								>
									{o.name}
								</a>{" "}
								—{" "}
								{o.requiresSuccessor
									? es
										? "Necesita sucesor o eliminación"
										: "Needs successor or deletion"
									: es
										? "Sin bloqueo de propiedad"
										: "No ownership blocker"}
							</li>
						))}
					</ul>
				)}
				{!request ? (
					<Button
						disabled={
							op.busy ||
							(!organizationId &&
								(!obligations || obligations.some((o) => o.requiresSuccessor)))
						}
						onClick={() =>
							void op.run(async () =>
								setRequest(
									await api().completion.deletionRequest({
										kind: organizationId ? "organization" : "account",
										organizationId,
										operationKey: crypto.randomUUID(),
									}),
								),
							)
						}
					>
						{es
							? "Preparar solicitud de eliminación"
							: "Prepare deletion request"}
					</Button>
				) : (
					<>
						<p>
							{es
								? "Guarda este enlace de estado. Solo permite consultar esta solicitud."
								: "Save this status link. It only allows viewing this request."}
						</p>
						<a
							href={`/${es ? "es" : "en"}/deletion#${request.id}.${request.receipt}`}
						>
							{es ? "Estado de eliminación" : "Deletion status"}
						</a>
						<label className="completion-check">
							<input
								type="checkbox"
								checked={consent}
								onChange={(e) => setConsent(e.target.checked)}
							/>
							{es
								? "Entiendo que al confirmar se revoca el acceso y comienza la eliminación irreversible."
								: "I understand that confirmation revokes access and starts irreversible deletion."}
						</label>
						<div className="completion-actions">
							<Button
								disabled={op.busy || !consent}
								onClick={() =>
									void op.run(async () => {
										await api().completion.deletionConfirm({ id: request.id });
										window.location.assign(
											`/${es ? "es" : "en"}/deletion#${request.id}.${request.receipt}`,
										);
									})
								}
							>
								{es ? "Confirmar eliminación" : "Confirm deletion"}
							</Button>
							<Button
								variant="secondary"
								disabled={op.busy}
								onClick={() =>
									void op.run(async () => {
										await api().completion.deletionCancel({ id: request.id });
										setRequest(undefined);
										setConsent(false);
									})
								}
							>
								{es ? "Cancelar solicitud" : "Cancel request"}
							</Button>
						</div>
					</>
				)}
			</section>
		</DashboardShell>
	);
}
export function ReceiptPage({
	unsubscribe = false,
}: {
	unsubscribe?: boolean;
}) {
	const op = useOperation(),
		{ es } = op;
	const [state, setState] =
		useState<Awaited<ReturnType<Client["deletionStatus"]>>>();
	return (
		<main className="completion-public">
			<h1>
				{unsubscribe
					? es
						? "Desactivar correo opcional"
						: "Unsubscribe from optional email"
					: es
						? "Estado de eliminación"
						: "Deletion status"}
			</h1>
			<Status {...op} />
			<Button
				disabled={op.busy}
				onClick={() =>
					void op.run(async () => {
						const receipt = window.location.hash.slice(1);
						if (unsubscribe) {
							await api().completion.unsubscribe({ receipt });
						} else {
							const split = receipt.indexOf(".");
							setState(
								await api().completion.deletionStatus({
									id: receipt.slice(0, split),
									receipt: receipt.slice(split + 1),
								}),
							);
						}
					})
				}
			>
				{unsubscribe
					? es
						? "Confirmar baja"
						: "Confirm unsubscribe"
					: es
						? "Consultar estado"
						: "Check status"}
			</Button>
			{state && (
				<section className="completion-card">
					<p>{state.state}</p>
					<p>
						{es ? "Pasos completados" : "Completed steps"}:{" "}
						{state.steps.join(", ") || "—"}
					</p>
					<p>
						{es ? "Conservado" : "Retained"}: {state.retained.join(", ")}
					</p>
					<p>
						{es
							? "La caducidad de las copias de seguridad no está confirmada."
							: "Backup expiry is not confirmed."}
					</p>
				</section>
			)}
		</main>
	);
}
