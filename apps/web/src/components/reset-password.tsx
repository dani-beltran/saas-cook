"use client";
import { useEffect, useRef, useState } from "react";
import { accountMessages } from "../i18n/account";
import { identityRequest } from "../lib/identity-request";
import { AuthFrame, AuthHeader, AuthNotice, AuthSubmit } from "./auth-ui";
import { NewPasswordFields } from "./new-password-fields";

export function ResetPassword() {
	const captured = useRef(false);
	const submitting = useRef(false);
	const [token, setToken] = useState<string | null>(null);
	const [locale, setLocale] = useState<"en" | "es">("en");
	const [ready, setReady] = useState(false);
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
		setReady(true);
	}, []);
	const labels = accountMessages[locale];
	return (
		<AuthFrame locale={locale} showLocaleSwitch={false}>
			<AuthHeader
				title={labels.resetPassword}
				description={labels.resetPasswordConfirmation}
			/>
			{!ready && (
				<p className="text-center text-sm text-muted-foreground" role="status">
					{labels.loading}
				</p>
			)}
			{complete && (
				<AuthNotice kind="success">{labels.resetPasswordComplete}</AuthNotice>
			)}
			{ready && !complete && !token && (
				<AuthNotice kind="error">{labels.resetPasswordFailed}</AuthNotice>
			)}
			{token && !complete && (
				<form
					className="space-y-5"
					aria-busy={busy}
					aria-describedby={error ? "reset-password-error" : undefined}
					onSubmit={async (event) => {
						event.preventDefault();
						if (submitting.current || !token) return;
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
						submitting.current = true;
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
							submitting.current = false;
							setBusy(false);
						}
					}}
				>
					<fieldset disabled={busy} className="space-y-5">
						<NewPasswordFields
							labels={{ ...labels, password: labels.newPassword }}
						/>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{labels.resetSecurityNote}
						</p>
					</fieldset>
					{error && (
						<AuthNotice kind="error" id="reset-password-error">
							{labels.resetPasswordFailed}
						</AuthNotice>
					)}
					<AuthSubmit busy={busy} pendingLabel={labels.loading} type="submit">
						{labels.resetPassword}
					</AuthSubmit>
				</form>
			)}
			{error && (
				<p className="mt-5 text-center">
					<a className="auth-link" href={`/${locale}/account?mode=reset`}>
						{labels.requestNewLink}
					</a>
				</p>
			)}
			<p className="mt-7 text-center text-sm">
				<a className="auth-link" href={`/${locale}/account`}>
					{labels.backToSignIn}
				</a>
			</p>
		</AuthFrame>
	);
}
