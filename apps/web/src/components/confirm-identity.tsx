"use client";
import { useEffect, useRef, useState } from "react";
import { accountMessages } from "../i18n/account";
import { AuthFrame, AuthHeader, AuthNotice, AuthSubmit } from "./auth-ui";

export function ConfirmIdentity() {
	const [token, setToken] = useState<string | null>(null);
	const [locale, setLocale] = useState<"en" | "es">("en");
	const [ready, setReady] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const captured = useRef(false);
	const submitting = useRef(false);
	useEffect(() => {
		if (captured.current) return;
		captured.current = true;
		const query = new URLSearchParams(window.location.search);
		setToken(query.get("token"));
		setLocale(query.get("locale") === "es" ? "es" : "en");
		setError(!query.get("token"));
		window.history.replaceState(null, "", "/auth/confirm");
		setReady(true);
	}, []);
	const labels = accountMessages[locale];
	const destination = `/${locale}/account`;
	return (
		<AuthFrame locale={locale} showLocaleSwitch={false}>
			<AuthHeader title={labels.confirm} description={labels.confirmation} />
			{!ready && (
				<p className="text-center text-sm text-muted-foreground" role="status">
					{labels.loading}
				</p>
			)}
			{ready && (
				<form
					className="space-y-5"
					aria-busy={busy}
					aria-describedby={error ? "confirmation-error" : undefined}
					onSubmit={async (event) => {
						event.preventDefault();
						if (submitting.current || !token) return;
						submitting.current = true;
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
							submitting.current = false;
						}
					}}
				>
					{error && (
						<AuthNotice kind="error" id="confirmation-error">
							{labels.confirmationFailed}
						</AuthNotice>
					)}
					{(token || busy) && (
						<AuthSubmit busy={busy} pendingLabel={labels.loading} type="submit">
							{labels.confirmAction}
						</AuthSubmit>
					)}
				</form>
			)}
			{error && (
				<p className="mt-5 text-center">
					<a className="auth-link" href={`/${locale}/account?mode=link`}>
						{labels.requestNewLink}
					</a>
				</p>
			)}
			<p className="mt-7 text-center text-sm">
				<a className="auth-link" href={destination}>
					{labels.backToSignIn}
				</a>
			</p>
		</AuthFrame>
	);
}
