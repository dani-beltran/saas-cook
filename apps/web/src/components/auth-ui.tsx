"use client";

import { Button } from "@common-saas/ui";
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useState,
} from "react";
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
	const [systemDark, setSystemDark] = useState(false);
	const [theme, setTheme] = useState<boolean | null>(null);
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		setSystemDark(media.matches);
		const change = () => setSystemDark(media.matches);
		media.addEventListener("change", change);
		return () => media.removeEventListener("change", change);
	}, []);
	const dark = theme ?? systemDark;
	return (
		<div className={`${dark ? "dark " : ""}auth-page`} lang={locale}>
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
				<button
					type="button"
					className="auth-theme"
					aria-label={labels.toggleTheme}
					aria-pressed={dark}
					onClick={() => setTheme(!dark)}
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						aria-hidden="true"
					>
						{dark ? (
							<>
								<circle cx="12" cy="12" r="4" />
								<path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
							</>
						) : (
							<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />
						)}
					</svg>
				</button>
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
