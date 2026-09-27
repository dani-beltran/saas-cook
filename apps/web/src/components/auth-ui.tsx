"use client";

import { Button } from "@common-saas/ui";
import type { ComponentProps, ReactNode } from "react";
import { accountMessages } from "../i18n/account";
import "./auth-ui.css";

export function AuthFrame({
	locale,
	children,
	showLocaleSwitch = false,
	localeMode = "password",
}: {
	locale: "en" | "es";
	children: ReactNode;
	showLocaleSwitch?: boolean;
	localeMode?: "password" | "register" | "link" | "reset" | "recover";
}) {
	const labels = accountMessages[locale];
	return (
		<div className="auth-page" lang={locale}>
			<div className="auth-tools">
				{showLocaleSwitch && (
					<a
						className="auth-link"
						href={`/${locale === "en" ? "es" : "en"}/account${localeMode === "password" ? "" : `?mode=${localeMode}`}`}
						lang={locale === "en" ? "es" : "en"}
					>
						{locale === "en" ? "Español" : "English"}
					</a>
				)}
			</div>
			<main className="auth-main">
				<div className="auth-panel">
					<div className="auth-mark">
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							role="img"
							aria-label={labels.placeholderLogo}
						>
							<title>{labels.placeholderLogo}</title>
							<rect
								x="3"
								y="3"
								width="7"
								height="7"
								rx="1.5"
								fill="currentColor"
							/>
							<rect
								x="14"
								y="3"
								width="7"
								height="7"
								rx="1.5"
								fill="currentColor"
								opacity=".5"
							/>
							<rect
								x="3"
								y="14"
								width="7"
								height="7"
								rx="1.5"
								fill="currentColor"
								opacity=".5"
							/>
							<rect
								x="14"
								y="14"
								width="7"
								height="7"
								rx="1.5"
								fill="currentColor"
							/>
						</svg>
					</div>
					{children}
				</div>
			</main>
		</div>
	);
}

export function AuthHeader({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<header className="auth-heading">
			<h1>{title}</h1>
			<p>{description}</p>
		</header>
	);
}

export function AuthNotice({
	kind,
	children,
	id,
}: {
	kind: "error" | "success";
	children: ReactNode;
	id?: string;
}) {
	return (
		<div
			id={id}
			className={`auth-notice ${kind === "error" ? "auth-error" : "auth-success"}`}
			role={kind === "error" ? "alert" : "status"}
			aria-atomic="true"
		>
			{children}
		</div>
	);
}

export function AuthSubmit({
	busy,
	pendingLabel,
	children,
	disabled,
	...props
}: ComponentProps<"button"> & { busy: boolean; pendingLabel: string }) {
	return (
		<Button
			{...props}
			type={props.type ?? "submit"}
			disabled={disabled || busy}
			className="auth-primary"
			aria-busy={busy}
		>
			{busy && <span className="auth-spinner" aria-hidden="true" />}
			<span aria-live="polite" aria-atomic="true">
				{busy ? pendingLabel : children}
			</span>
		</Button>
	);
}
