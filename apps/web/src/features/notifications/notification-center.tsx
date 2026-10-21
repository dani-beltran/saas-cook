"use client";
import { Button } from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "../../lib/api-client";
/**
 * Displays in-app notifications and contextual help for the selected organization.
 * @param props - Optional organizationId scopes reads; no organization means no tenant requests.
 * @returns An expandable notification center. Unavailable feeds remain empty and grant no access.
 */
export function NotificationCenter({
	organizationId,
}: {
	organizationId?: string;
}) {
	const locale = useLocale();
	const t = useTranslations("Notifications.Center");
	const [notices, setNotices] = useState<
			Awaited<ReturnType<ReturnType<typeof api>["notifications"]["list"]>>
		>([]),
		[contact, setContact] = useState(false);
	useEffect(() => {
		let active = true;
		if (organizationId) {
			void api()
				.notifications.list({ organizationId })
				.then((r) => {
					if (active) setNotices(r);
				})
				.catch(() => {});
			void api()
				.organizationSettings.flags({ organizationId })
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
		<details className="feature-card">
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
				<ul className="feature-list">
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
												.notifications.markRead({
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

import "../../components/feature-ui.css";
