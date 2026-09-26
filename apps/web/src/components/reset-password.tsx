"use client";
import { Button } from "@common-saas/ui";
import { useEffect, useRef, useState } from "react";
import { accountMessages } from "../i18n/account";
import { identityRequest } from "../lib/identity-request";
import { NewPasswordFields } from "./new-password-fields";

export function ResetPassword() {
	const captured = useRef(false);
	const [token, setToken] = useState<string | null>(null);
	const [locale, setLocale] = useState<"en" | "es">("en");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const [complete, setComplete] = useState(false);
	useEffect(() => {
		if (captured.current) return;
		captured.current = true;
		const query = new URLSearchParams(window.location.search);
		setToken(query.get("token"));
		setLocale(query.get("locale") === "es" ? "es" : "en");
		setError(!query.get("token"));
		window.history.replaceState(null, "", "/auth/reset-password");
	}, []);
	const labels = accountMessages[locale];
	return (
		<main className="mx-auto max-w-lg space-y-6 p-8" lang={locale}>
			<h1 className="text-3xl font-semibold">{labels.resetPassword}</h1>
			<p>{labels.resetPasswordConfirmation}</p>
			<p role="alert">{error && labels.resetPasswordFailed}</p>
			{complete ? (
				<p role="status">{labels.resetPasswordComplete}</p>
			) : (
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						const form = event.currentTarget;
						const data = new FormData(form);
						if (data.get("password") !== data.get("confirmPassword")) {
							const confirmation = form.elements.namedItem("confirmPassword");
							if (confirmation instanceof HTMLInputElement) {
								confirmation.setCustomValidity(labels.passwordMismatch);
								confirmation.reportValidity();
							}
							return;
						}
						setBusy(true);
						setError(false);
						try {
							await identityRequest("reset-password", {
								token,
								newPassword: data.get("password"),
							});
							form.reset();
							setToken(null);
							setComplete(true);
						} catch {
							setError(true);
						} finally {
							setBusy(false);
						}
					}}
				>
					<NewPasswordFields
						labels={{ ...labels, password: labels.newPassword }}
					/>
					<Button disabled={busy || !token} type="submit">
						{labels.resetPassword}
					</Button>
				</form>
			)}
			<a className="block underline" href={`/${locale}/account`}>
				{labels.backToSignIn}
			</a>
		</main>
	);
}
