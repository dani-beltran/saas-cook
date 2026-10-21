"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Status, useOperation } from "../../components/feature-ui";
import { api } from "../../lib/api-client";

/**
 * Loads and saves the signed-in user's optional notification preferences.
 * Mandatory notices and sticky email suppression remain controlled by server policy.
 * @returns Preference controls with their own pending/error state; API failures never imply a saved preference.
 */
export function NotificationPreferences() {
	const op = useOperation();
	const { locale } = op;
	const t = useTranslations("Notifications.Preferences");
	const [preferences, setPreferences] =
		useState<
			Awaited<
				ReturnType<ReturnType<typeof api>["notifications"]["preferences"]>
			>
		>();
	useEffect(() => {
		let active = true;
		void api()
			.notifications.preferences({})
			.then((p) => {
				if (active) setPreferences(p);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);
	return (
		<section aria-label={t("notificationsTitle")}>
			<Status {...op} />
			<h2>{t("notificationsTitle")}</h2>
			{preferences && (
				<>
					<label className="feature-check">
						<input
							type="checkbox"
							checked={preferences.email}
							disabled={op.busy || preferences.suppressed}
							onChange={(e) =>
								void op.run(async () => {
									await api().notifications.savePreferences({
										email: e.target.checked,
										inApp: preferences.inApp,
										locale,
										version: preferences.version,
									});
									setPreferences(await api().notifications.preferences({}));
								})
							}
						/>
						{t("email")}
					</label>
					<label className="feature-check">
						<input
							type="checkbox"
							checked={preferences.inApp}
							disabled={op.busy}
							onChange={(e) =>
								void op.run(async () => {
									await api().notifications.savePreferences({
										email: preferences.email,
										inApp: e.target.checked,
										locale,
										version: preferences.version,
									});
									setPreferences(await api().notifications.preferences({}));
								})
							}
						/>
						{t("inApp")}
					</label>
					{preferences.suppressed && <p>{t("suppressed")}</p>}
				</>
			)}
			<p>{t("mandatoryNotice")}</p>
		</section>
	);
}
