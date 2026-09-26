"use client";
import { Button } from "@common-saas/ui";
import { useEffect, useRef, useState } from "react";
export function ConfirmIdentity() {
	const [token, setToken] = useState<string | null>(null);
	const [locale, setLocale] = useState<"en" | "es">("en");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const captured = useRef(false);
	useEffect(() => {
		if (captured.current) return;
		captured.current = true;
		const query = new URLSearchParams(window.location.search);
		setToken(query.get("token"));
		setLocale(query.get("locale") === "es" ? "es" : "en");
		window.history.replaceState(null, "", "/auth/confirm");
	}, []);
	const spanish = locale === "es";
	const destination = `/${locale}/account`;
	return (
		<main className="mx-auto max-w-lg space-y-6 p-8" lang={locale}>
			<h1 className="text-3xl font-semibold">
				{spanish ? "Confirmar acceso" : "Confirm sign-in"}
			</h1>
			<p>
				{spanish
					? "Continúa solo si solicitaste este enlace de acceso."
					: "Continue only if you requested this sign-in link."}
			</p>
			<p role="alert">
				{error &&
					(spanish
						? "El enlace no es válido o ha caducado. Solicita uno nuevo."
						: "This link is invalid or expired. Request a new sign-in link.")}
			</p>
			<Button
				disabled={busy || !token}
				onClick={async () => {
					setBusy(true);
					setError(false);
					try {
						const response = await fetch("/api/auth/confirm", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ token, destination }),
						});
						if (!response.ok) throw new Error("expired");
						const result = await response.json();
						if (result.destination !== destination)
							throw new Error("destination");
						setToken(null);
						window.location.assign(destination);
					} catch {
						setError(true);
						setBusy(false);
					}
				}}
			>
				{spanish ? "Confirmar" : "Confirm"}
			</Button>
			<a className="block underline" href={destination}>
				{spanish ? "Volver al acceso" : "Back to sign-in"}
			</a>
		</main>
	);
}
