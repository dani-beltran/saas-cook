"use client";
import { Button } from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "./common";
export function WorkspaceHelp({ organizationId }: { organizationId?: string }) {
	const locale = useLocale();
	const t = useTranslations("Phase6.Widget");
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
				{t("title")}
				{notices.some((n) => !n.read) ? " •" : ""}
			</summary>
			<p>
				<a href={`/${locale}/help`}>{t("help")}</a>
			</p>
			{contact && <p>{t("contact")}</p>}
			{notices.length === 0 ? (
				<p>{t("noNotifications")}</p>
			) : (
				<ul className="completion-list">
					{notices.map((n) => (
						<li key={n.id}>
							<a href={`/${locale}/organizations/${organizationId}/data`}>
								{t("jobFinished")}
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
									{t("markRead")}
								</Button>
							)}
						</li>
					))}
				</ul>
			)}
		</details>
	);
}
