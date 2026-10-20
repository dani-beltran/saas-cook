"use client";
import { createApiClient } from "@saas-cook/api/client";
import { Button } from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { resolveLocale } from "../../i18n/locales";
import "./completion.css";
export const api = () => createApiClient(`${window.location.origin}/api/rpc`);
export function useOperation() {
	const locale = resolveLocale(useLocale());
	const t = useTranslations("Phase6.Common");
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
export function Status({ busy, message }: { busy: boolean; message: string }) {
	const t = useTranslations("Phase6.Common");
	return (
		<p role="status" aria-live="polite">
			{busy ? t("working") : message}
		</p>
	);
}
export function download(value: {
	base64: string;
	filename: string;
	contentType: string;
}) {
	const bytes = Uint8Array.from(atob(value.base64), (c) => c.charCodeAt(0)),
		url = URL.createObjectURL(new Blob([bytes], { type: value.contentType }));
	const a = document.createElement("a");
	a.href = url;
	a.download = value.filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Reload({
	load,
	disabled,
}: {
	load: () => void;
	disabled?: boolean;
}) {
	const t = useTranslations("Phase6.Common");
	return (
		<Button onClick={load} disabled={disabled} variant="secondary">
			{t("refresh")}
		</Button>
	);
}
