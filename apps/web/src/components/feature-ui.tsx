"use client";
import { Button } from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { resolveLocale } from "../i18n/locales";
import "./feature-ui.css";
/**
 * Tracks one client operation and presents a localized pending, success or failure message.
 * The busy flag coordinates UI only; services must still enforce authorization.
 * @returns The current locale, busy/message state and an async run callback that catches failures.
 */
export function useOperation() {
	const locale = resolveLocale(useLocale());
	const t = useTranslations("FeatureUi");
	const [busy, setBusy] = useState(false),
		[message, setMessage] = useState("");
	async function run(work: () => Promise<unknown>) {
		if (busy) return;
		setBusy(true);
		setMessage("");
		try {
			await work();
			setMessage(t("completed"));
		} catch {
			setMessage(t("failed"));
		} finally {
			setBusy(false);
		}
	}
	return { locale, busy, message, run };
}
/**
 * Renders an accessible live status message for an operation.
 * @param props - busy selects the translated pending text; message supplies the settled status.
 * @returns A polite live region suitable for success and failure announcements.
 */
export function Status({ busy, message }: { busy: boolean; message: string }) {
	const t = useTranslations("FeatureUi");
	return (
		<p role="status" aria-live="polite">
			{busy ? t("working") : message}
		</p>
	);
}
/**
 * Renders a translated refresh button for a feature's existing loader.
 * @param props - load runs on click; disabled prevents clicks while work is pending.
 * @returns A secondary button. The supplied loader owns asynchronous error handling.
 */
export function Reload({
	load,
	disabled,
}: {
	load: () => void;
	disabled?: boolean;
}) {
	const t = useTranslations("FeatureUi");
	return (
		<Button onClick={load} disabled={disabled} variant="secondary">
			{t("refresh")}
		</Button>
	);
}
