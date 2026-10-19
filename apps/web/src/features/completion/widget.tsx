"use client";
import { Button } from "@saas-cook/ui";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "./common";
export function WorkspaceHelp({ organizationId }: { organizationId?: string }) {
	const locale = useLocale(),
		es = locale === "es";
	const [notices, setNotices] = useState<
			Awaited<ReturnType<ReturnType<typeof api>["completion"]["notifications"]>>
		>([]),
		[contact, setContact] = useState(false);
	useEffect(() => {
		let active = true;
		if (organizationId) {
			void api()
				.completion.notifications({ organizationId })
				.then((r) => {
					if (active) setNotices(r);
				})
				.catch(() => {});
			void api()
				.completion.flags({ organizationId })
				.then((r) => {
					if (active) setContact(r.helpContact);
				})
				.catch(() => {});
		}
		return () => {
			active = false;
		};
	}, [organizationId]);
	return (
		<details className="completion-card">
			<summary>
				{es ? "Ayuda y notificaciones" : "Help and notifications"}
				{notices.some((n) => !n.read) ? " •" : ""}
			</summary>
			<p>
				<a href={`/${locale}/help`}>{es ? "Centro de ayuda" : "Help center"}</a>
			</p>
			{contact && (
				<p>
					{es
						? "Para ayuda con esta organización, contacta con el administrador de tu instalación y comparte solo el identificador de la solicitud fallida."
						: "For help with this organization, contact your installation administrator and share only the failed request identifier."}
				</p>
			)}
			{notices.length === 0 ? (
				<p>{es ? "No tienes notificaciones." : "You have no notifications."}</p>
			) : (
				<ul className="completion-list">
					{notices.map((n) => (
						<li key={n.id}>
							<a href={`/${locale}/organizations/${organizationId}/data`}>
								{es
									? "Un trabajo de datos ha terminado."
									: "A data job has finished."}
							</a>
							{!n.read && (
								<Button
									variant="ghost"
									onClick={() => {
										if (organizationId)
											void api()
												.completion.notificationRead({
													organizationId,
													id: n.id,
												})
												.then(() =>
													setNotices((items) =>
														items.map((i) =>
															i.id === n.id ? { ...i, read: true } : i,
														),
													),
												)
												.catch(() => {});
									}}
								>
									{es ? "Marcar como leído" : "Mark read"}
								</Button>
							)}
						</li>
					))}
				</ul>
			)}
		</details>
	);
}
