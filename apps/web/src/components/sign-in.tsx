"use client";
import { Input } from "@common-saas/ui";
import { useLocale, useTranslations } from "next-intl";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { IdentityRequestError, identityRequest } from "../lib/identity-request";
import { AuthFrame, AuthHeader, AuthNotice, AuthSubmit } from "./auth-ui";
import { NewPasswordFields } from "./new-password-fields";
import { PasswordField } from "./password-field";

type SignInMode = "password" | "register" | "link" | "reset" | "recover";
const modeCopy = {
	password: {
		title: "signInTitle",
		description: "signInDescription",
		action: "signInAction",
		pending: "signingIn",
	},
	register: {
		title: "registerTitle",
		description: "registerDescription",
		action: "register",
		pending: "creatingAccount",
	},
	link: {
		title: "linkTitle",
		description: "linkDescription",
		action: "signIn",
		pending: "sendingEmail",
	},
	reset: {
		title: "resetTitle",
		description: "resetDescription",
		action: "resetPasswordRequest",
		pending: "sendingEmail",
	},
	recover: {
		title: "recoverTitle",
		description: "recoverDescription",
		action: "recoveryAction",
		pending: "sendingEmail",
	},
} as const;
function readMode(): SignInMode {
	const value = new URLSearchParams(window.location.search).get("mode");
	return value && Object.hasOwn(modeCopy, value)
		? (value as SignInMode)
		: "password";
}

export function SignIn({
	refreshSession,
	passkeySignIn,
}: {
	refreshSession: () => Promise<unknown>;
	passkeySignIn: () => Promise<void>;
}) {
	const t = useTranslations("Account");
	const locale = useLocale();
	const [mode, setMode] = useState<SignInMode>("password");
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState<"form" | "passkey" | null>(null);
	const submitting = useRef(false);
	const [error, setError] = useState("");
	const [complete, setComplete] = useState(false);
	const [signedIn, setSignedIn] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
	const heading = useRef<HTMLDivElement>(null);
	const focusOnChange = useRef(false);
	useEffect(() => {
		setMode(readMode());
	}, []);
	useEffect(() => {
		// Mode navigation moves focus to the new view without opening the mobile keyboard.
		if (focusOnChange.current) {
			heading.current?.focus();
			focusOnChange.current = false;
		}
	});
	const copy = modeCopy[mode];
	function switchMode(event: MouseEvent<HTMLAnchorElement>, next: SignInMode) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		if (submitting.current) return;
		focusOnChange.current = true;
		setMode(next);
		setComplete(false);
		setSignedIn(false);
		setError("");
		setFieldErrors({});
		window.history.replaceState(
			null,
			"",
			`/${locale}/account${next === "password" ? "" : `?mode=${next}`}`,
		);
	}
	function modeLink(next: SignInMode, label: string, className = "auth-link") {
		return (
			<a
				className={className}
				href={`/${locale}/account?mode=${next}`}
				aria-disabled={busy ? true : undefined}
				onClick={(event) => switchMode(event, next)}
			>
				{label}
			</a>
		);
	}
	async function perform(
		action: () => Promise<void>,
		kind: "form" | "passkey",
	) {
		if (submitting.current) return;
		submitting.current = true;
		setBusy(kind);
		setError("");
		try {
			await action();
		} catch (failure) {
			setError(
				t(
					failure instanceof IdentityRequestError && failure.status === 503
						? "unavailable"
						: failure instanceof IdentityRequestError && failure.status === 429
							? "tooManyRequests"
							: kind === "passkey"
								? "passkeyFailed"
								: mode === "password"
									? "passwordSignInFailed"
									: "authFailed",
				),
			);
		} finally {
			submitting.current = false;
			setBusy(null);
		}
	}
	return (
		<AuthFrame
			locale={locale === "es" ? "es" : "en"}
			showLocaleSwitch
			localeMode={mode}
		>
			<div ref={heading} tabIndex={-1} className="outline-none">
				<AuthHeader
					title={t(complete ? "checkEmail" : copy.title)}
					description={t(complete ? "checkEmailDescription" : copy.description)}
				/>
			</div>
			{complete ? (
				<div className="space-y-5">
					<AuthNotice kind="success">
						{t(
							mode === "register"
								? "registrationSent"
								: mode === "reset"
									? "resetPasswordSent"
									: "sent",
						)}
					</AuthNotice>
					<p className="text-sm leading-relaxed text-muted-foreground">
						{t(mode === "reset" ? "resetEmailNextStep" : "emailNextStep")}
					</p>
					{mode === "recover" && (
						<p className="text-sm leading-relaxed text-muted-foreground">
							{t("recoveryHelp")}
						</p>
					)}
					{modeLink("password", t("backToSignIn"), "auth-secondary")}
					<p className="text-center">{modeLink(mode, t("tryAnotherEmail"))}</p>
				</div>
			) : (
				<>
					<form
						key={mode}
						className="space-y-5"
						aria-label={t(copy.title)}
						aria-describedby={error ? "auth-feedback" : undefined}
						aria-busy={busy === "form"}
						onSubmit={(event) => {
							event.preventDefault();
							if (submitting.current) return;
							const form = event.currentTarget;
							const data = new FormData(form);
							if (
								mode === "register" &&
								data.get("password") !== data.get("confirmPassword")
							) {
								const confirmation = form.elements.namedItem("confirmPassword");
								if (confirmation instanceof HTMLInputElement) {
									confirmation.setCustomValidity(t("passwordMismatch"));
									confirmation.reportValidity();
								}
								return;
							}
							void perform(async () => {
								if (mode === "password") {
									await identityRequest("sign-in/email", {
										email,
										password: data.get("password"),
									});
									form.reset();
									await refreshSession();
									setSignedIn(true);
								} else {
									if (mode === "register") {
										await identityRequest("register", {
											email,
											name: String(data.get("name") ?? "").trim(),
											password: data.get("password"),
											locale,
										});
										form.reset();
									} else if (mode === "reset" || mode === "recover") {
										await identityRequest(
											mode === "reset"
												? "request-password-reset"
												: "request-recovery",
											{ email, locale },
										);
									} else {
										await identityRequest("sign-in/magic-link", {
											email,
											callbackURL: `/${locale}/account`,
											locale,
										});
									}
									focusOnChange.current = true;
									setComplete(true);
								}
							}, "form");
						}}
					>
						<fieldset disabled={Boolean(busy)} className="space-y-5">
							<div className="grid gap-2">
								<label htmlFor="sign-in-email">{t("email")}</label>
								<Input
									id="sign-in-email"
									className="auth-input"
									name="email"
									type="email"
									autoComplete="username"
									autoCapitalize="none"
									spellCheck={false}
									value={email}
									onChange={(event) => {
										setEmail(event.currentTarget.value);
										setFieldErrors((errors) => ({ ...errors, email: false }));
									}}
									onInvalid={() =>
										setFieldErrors((errors) => ({ ...errors, email: true }))
									}
									aria-invalid={fieldErrors.email || undefined}
									aria-describedby={
										fieldErrors.email ? "email-error" : undefined
									}
									required
								/>
								{fieldErrors.email && (
									<p
										id="email-error"
										className="text-xs text-destructive"
										role="alert"
									>
										{t("emailInvalid")}
									</p>
								)}
							</div>
							{mode === "register" && (
								<>
									<div className="grid gap-2">
										<label htmlFor="sign-in-name">{t("name")}</label>
										<Input
											id="sign-in-name"
											className="auth-input"
											name="name"
											autoComplete="name"
											maxLength={80}
											required
											onInvalid={() =>
												setFieldErrors((errors) => ({ ...errors, name: true }))
											}
											onInput={() =>
												setFieldErrors((errors) => ({ ...errors, name: false }))
											}
											aria-invalid={fieldErrors.name || undefined}
											aria-describedby={
												fieldErrors.name ? "name-error" : undefined
											}
										/>
										{fieldErrors.name && (
											<p
												id="name-error"
												className="text-xs text-destructive"
												role="alert"
											>
												{t("nameRequired")}
											</p>
										)}
									</div>
									<NewPasswordFields
										labels={{
											password: t("password"),
											confirmPassword: t("confirmPassword"),
											passwordHelp: t("passwordHelp"),
											passwordMismatch: t("passwordMismatch"),
											showPassword: t("showPassword"),
											hidePassword: t("hidePassword"),
											showConfirmPassword: t("showConfirmPassword"),
											hideConfirmPassword: t("hideConfirmPassword"),
										}}
									/>
								</>
							)}
							{mode === "password" && (
								<div className="grid gap-2">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<label htmlFor="sign-in-password">{t("password")}</label>
										{modeLink("reset", t("forgotPassword"))}
									</div>
									<PasswordField
										id="sign-in-password"
										name="password"
										autoComplete="current-password"
										maxLength={128}
										required
										showLabel={t("showPassword")}
										hideLabel={t("hidePassword")}
										onInvalid={() =>
											setFieldErrors((errors) => ({
												...errors,
												password: true,
											}))
										}
										onInput={() =>
											setFieldErrors((errors) => ({
												...errors,
												password: false,
											}))
										}
										aria-invalid={fieldErrors.password || undefined}
										aria-describedby={
											fieldErrors.password ? "password-error" : undefined
										}
									/>
									{fieldErrors.password && (
										<p
											id="password-error"
											className="text-xs text-destructive"
											role="alert"
										>
											{t("passwordRequired")}
										</p>
									)}
								</div>
							)}
							{mode === "register" && (
								<p className="text-xs leading-relaxed text-muted-foreground">
									{t("registrationHelp")}
								</p>
							)}
							{mode === "recover" && (
								<p className="text-sm leading-relaxed text-muted-foreground">
									{t("recoveryHelp")}
								</p>
							)}
						</fieldset>
						{error && (
							<AuthNotice id="auth-feedback" kind="error">
								{error}
							</AuthNotice>
						)}
						{signedIn && (
							<AuthNotice kind="success">{t("signedIn")}</AuthNotice>
						)}
						<AuthSubmit
							busy={busy === "form"}
							disabled={Boolean(busy)}
							pendingLabel={t(copy.pending)}
						>
							{t(copy.action)}
						</AuthSubmit>
					</form>
					{mode === "password" && (
						<>
							<div className="auth-divider">{t("alternativeMethods")}</div>
							<div className="space-y-2.5">
								<button
									type="button"
									className="auth-secondary"
									disabled={Boolean(busy)}
									aria-busy={busy === "passkey"}
									onClick={() => void perform(passkeySignIn, "passkey")}
								>
									<svg
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
										aria-hidden="true"
									>
										<circle cx="8" cy="9" r="4" />
										<path d="m11 12 9 9m-4-4 3-3m-6 0 3-3M3 20v-1a4 4 0 0 1 4-4" />
									</svg>
									<span aria-live="polite" aria-atomic="true">
										{t(busy === "passkey" ? "passkeyPending" : "passkey")}
									</span>
								</button>
								{modeLink("link", t("useEmailLink"), "auth-secondary")}
							</div>
						</>
					)}
					<div className="auth-footer">
						{mode === "password" ? (
							<>
								{t("noAccount")} {modeLink("register", t("createAccountLink"))}
							</>
						) : mode === "register" ? (
							<>
								{t("hasAccount")} {modeLink("password", t("signInAction"))}
							</>
						) : (
							modeLink("password", t("backToSignIn"))
						)}
					</div>
					{(mode === "password" || mode === "reset" || mode === "link") && (
						<p className="mt-5 text-center">
							{modeLink("recover", t("recover"), "auth-link auth-link-muted")}
						</p>
					)}
				</>
			)}
		</AuthFrame>
	);
}
