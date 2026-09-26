"use client";
import { Button, Input } from "@common-saas/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { identityRequest } from "../lib/identity-request";
import { NewPasswordFields } from "./new-password-fields";

type SignInMode = "password" | "register" | "link" | "reset" | "recover";
export function SignIn({
	busy,
	perform,
	refreshSession,
	passkeySignIn,
}: {
	busy: boolean;
	perform: (
		action: () => Promise<unknown>,
		success?: string,
		failure?: string,
	) => Promise<void>;
	refreshSession: () => Promise<unknown>;
	passkeySignIn: () => Promise<void>;
}) {
	const t = useTranslations("Account");
	const locale = useLocale();
	const [mode, setMode] = useState<SignInMode>("password");
	const [email, setEmail] = useState("");
	const labels = {
		password: "passwordSignIn",
		register: "register",
		link: "signIn",
		reset: "resetPasswordRequest",
		recover: "recover",
	} as const;
	return (
		<section className="max-w-lg space-y-5 rounded-xl border border-border bg-card p-6">
			<h2 className="text-xl font-semibold">{t(labels[mode])}</h2>
			{mode === "register" && <p>{t("registrationHelp")}</p>}
			{mode === "reset" && <p>{t("resetPasswordHelp")}</p>}
			{mode === "recover" && <p>{t("recoveryHelp")}</p>}
			<form
				key={mode}
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
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
					void perform(
						async () => {
							if (mode === "password") {
								await identityRequest("sign-in/email", {
									email,
									password: data.get("password"),
								});
								form.reset();
								await refreshSession();
							} else if (mode === "register") {
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
						},
						mode === "password"
							? "signedIn"
							: mode === "reset"
								? "resetPasswordSent"
								: "sent",
						mode === "password" ? "passwordSignInFailed" : "failed",
					);
				}}
			>
				<label htmlFor="sign-in-email" className="grid gap-2">
					{t("email")}
					<Input
						id="sign-in-email"
						name="email"
						type="email"
						autoComplete="username"
						value={email}
						onChange={(event) => setEmail(event.currentTarget.value)}
						required
					/>
				</label>
				{mode === "register" && (
					<>
						<label htmlFor="sign-in-name" className="grid gap-2">
							{t("name")}
							<Input
								id="sign-in-name"
								name="name"
								autoComplete="name"
								maxLength={80}
								required
							/>
						</label>
						<NewPasswordFields
							labels={{
								password: t("password"),
								confirmPassword: t("confirmPassword"),
								passwordHelp: t("passwordHelp"),
								passwordMismatch: t("passwordMismatch"),
							}}
						/>
					</>
				)}
				{mode === "password" && (
					<label htmlFor="sign-in-password" className="grid gap-2">
						{t("password")}
						<Input
							id="sign-in-password"
							name="password"
							type="password"
							autoComplete="current-password"
							maxLength={128}
							required
						/>
					</label>
				)}
				<Button disabled={busy} type="submit">
					{t(labels[mode])}
				</Button>
			</form>
			<div className="flex flex-wrap gap-3">
				{mode !== "password" && (
					<Button disabled={busy} onClick={() => setMode("password")}>
						{t("backToSignIn")}
					</Button>
				)}
				{mode === "password" && (
					<>
						<Button disabled={busy} onClick={() => setMode("register")}>
							{t("register")}
						</Button>
						<Button disabled={busy} onClick={() => setMode("reset")}>
							{t("forgotPassword")}
						</Button>
					</>
				)}
				{mode !== "link" && (
					<Button disabled={busy} onClick={() => setMode("link")}>
						{t("signIn")}
					</Button>
				)}
				{mode !== "recover" && (
					<Button disabled={busy} onClick={() => setMode("recover")}>
						{t("recover")}
					</Button>
				)}
				<Button disabled={busy} onClick={() => void perform(passkeySignIn)}>
					{t("passkey")}
				</Button>
			</div>
		</section>
	);
}
