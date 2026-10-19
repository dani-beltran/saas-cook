"use client";
import { createApiClient } from "@saas-cook/api/client";
import { Button } from "@saas-cook/ui";
import { useLocale } from "next-intl";
import { useState } from "react";
import "./completion.css";
export const api = () => createApiClient(`${window.location.origin}/api/rpc`);
export function useOperation() {
	const es = useLocale() === "es";
	const [busy, setBusy] = useState(false),
		[message, setMessage] = useState("");
	async function run(work: () => Promise<unknown>) {
		if (busy) return;
		setBusy(true);
		setMessage("");
		try {
			await work();
			setMessage(es ? "Operación completada." : "Operation completed.");
		} catch {
			setMessage(
				es
					? "No se pudo completar. Comprueba tus permisos, confirma tu identidad e inténtalo de nuevo."
					: "Could not complete. Check your access, confirm your identity, and try again.",
			);
		} finally {
			setBusy(false);
		}
	}
	return { es, busy, message, run };
}
export function Status({ busy, message }: { busy: boolean; message: string }) {
	const es = useLocale() === "es";
	return (
		<p role="status" aria-live="polite">
			{busy ? (es ? "Procesando…" : "Working…") : message}
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
	const es = useLocale() === "es";
	return (
		<Button onClick={load} disabled={disabled} variant="secondary">
			{es ? "Actualizar" : "Refresh"}
		</Button>
	);
}
