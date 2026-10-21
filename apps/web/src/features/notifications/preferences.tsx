"use client";
import { Button, Checkbox } from "@saas-cook/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Status, useOperation } from "../../components/feature-ui";
import { api } from "../../lib/api-client";
import "./preferences.css";

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
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [retry, setRetry] = useState(0);
	useEffect(() => {
		void retry;
		let active = true;
		setState("loading");
		void api()
			.notifications.preferences({})
			.then((p) => {
				if (active) {
					setPreferences(p);
					setState("ready");
				}
			})
			.catch(() => {
				if (active) setState("error");
			});
		return () => {
			active = false;
		};
	}, [retry]);
	return (
		<section
			className="notification-preferences"
			aria-labelledby="notification-preferences-title"
		>
			<h2 id="notification-preferences-title">{t("notificationsTitle")}</h2>
			<p>{t("description")}</p>
			{state === "loading" && <p role="status">{t("loading")}</p>}
			{state === "error" && (
				<div className="notification-preferences-feedback">
					<p role="status">{t("unavailable")}</p>
					<Button
						variant="secondary"
						onClick={() => setRetry((value) => value + 1)}
					>
						{t("retry")}
					</Button>
				</div>
			)}
			{state === "ready" && preferences && (
				<div className="notification-preferences-options">
					<div className="notification-preferences-choice">
						<Checkbox
							id="notification-email"
							aria-describedby="notification-email-description"
							checked={preferences.email}
							disabled={op.busy || preferences.suppressed}
							onCheckedChange={(checked) =>
								void op.run(async () => {
									await api().notifications.savePreferences({
										email: checked === true,
										inApp: preferences.inApp,
										locale,
										version: preferences.version,
									});
									setPreferences(await api().notifications.preferences({}));
								})
							}
						/>
						<div>
							<label htmlFor="notification-email">{t("email")}</label>
							<p id="notification-email-description">{t("emailDescription")}</p>
						</div>
					</div>
					<div className="notification-preferences-choice">
						<Checkbox
							id="notification-in-app"
							aria-describedby="notification-in-app-description"
							checked={preferences.inApp}
							disabled={op.busy}
							onCheckedChange={(checked) =>
								void op.run(async () => {
									await api().notifications.savePreferences({
										email: preferences.email,
										inApp: checked === true,
										locale,
										version: preferences.version,
									});
									setPreferences(await api().notifications.preferences({}));
								})
							}
						/>
						<div>
							<label htmlFor="notification-in-app">{t("inApp")}</label>
							<p id="notification-in-app-description">
								{t("inAppDescription")}
							</p>
						</div>
					</div>
					{preferences.suppressed && <p>{t("suppressed")}</p>}
				</div>
			)}
			<p className="notification-preferences-note">{t("mandatoryNotice")}</p>
			<Status {...op} />
		</section>
	);
}
