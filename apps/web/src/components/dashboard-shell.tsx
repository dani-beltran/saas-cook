"use client";

import { createApiClient } from "@common-saas/api/client";
import { useLocale } from "next-intl";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { dashboardMessages } from "../i18n/dashboard";
import { identityClient } from "../lib/identity-client";
import "./dashboard.css";

const AppName = createContext("Common SaaS");
export function DashboardBrand({
	name,
	children,
}: {
	name: string;
	children: ReactNode;
}) {
	return <AppName.Provider value={name}>{children}</AppName.Provider>;
}

function NavigationIcon({
	kind,
}: {
	kind: "account" | "organization" | "projects" | "customers";
}) {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden="true"
		>
			{kind === "account" || kind === "customers" ? (
				<>
					<circle cx="12" cy="8" r="3.5" />
					<path d="M5 21v-3a7 7 0 0 1 14 0v3" />
				</>
			) : kind === "projects" ? (
				<>
					<rect x="3" y="3" width="7" height="7" rx="1.5" />
					<rect x="14" y="3" width="7" height="7" rx="1.5" />
					<rect x="3" y="14" width="7" height="7" rx="1.5" />
					<rect x="14" y="14" width="7" height="7" rx="1.5" />
				</>
			) : (
				<path d="M4 21V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v17M2 21h20M9 21v-5h6v5M8 7h2m4 0h2M8 11h2m4 0h2" />
			)}
		</svg>
	);
}

export function DashboardShell({
	section,
	organizationId,
	children,
	onLocaleChange,
}: {
	section: "account" | "organization" | "projects" | "customers";
	organizationId?: string;
	children: ReactNode;
	onLocaleChange?: (locale: "en" | "es") => void;
}) {
	const { data: session } = identityClient.useSession();
	const [organizations, setOrganizations] = useState<
		Array<{ id: string; name: string }>
	>([]);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [retry, setRetry] = useState(0);
	const pendingMfa = Boolean(
		session?.user.twoFactorEnabled &&
			!(session.session as { mfa?: boolean }).mfa,
	);
	const sessionId = session?.session.id;
	useEffect(() => {
		void retry;
		let active = true;
		setOrganizations([]);
		if (!sessionId || pendingMfa) {
			setState("ready");
			return;
		}
		setState("loading");
		void createApiClient(`${window.location.origin}/api/rpc`)
			.organizations.list({})
			.then((items) => {
				if (active) {
					setOrganizations(items);
					setState("ready");
				}
			})
			.catch(() => {
				if (active) setState("error");
			});
		return () => {
			active = false;
		};
	}, [sessionId, pendingMfa, retry]);
	return (
		<DashboardFrame
			section={section}
			onLocaleChange={onLocaleChange}
			organizationId={organizationId}
			organizations={organizations}
			state={state}
			pendingMfa={pendingMfa}
			user={session?.user}
			onRetry={() => setRetry((value) => value + 1)}
		>
			{children}
		</DashboardFrame>
	);
}

// Presentation is separate so stories can exercise real navigation states without identity mocks.
export function DashboardFrame({
	section,
	organizationId,
	children,
	organizations,
	state,
	pendingMfa = false,
	user,
	onRetry,
	onLocaleChange,
}: {
	section: "account" | "organization" | "projects" | "customers";
	organizationId?: string;
	children: ReactNode;
	organizations: Array<{ id: string; name: string }>;
	state: "loading" | "ready" | "error";
	pendingMfa?: boolean;
	user?: { name?: string | null; email: string };
	onRetry: () => void;
	onLocaleChange?: (locale: "en" | "es") => void;
}) {
	const locale = useLocale() === "es" ? "es" : "en";
	const copy = dashboardMessages[locale];
	const name = useContext(AppName);
	const [open, setOpen] = useState(false);
	const current = organizations.find((item) => item.id === organizationId);
	const organizationPath = `/${locale}/organizations/${organizationId}`;
	const link = (kind: typeof section, label: string, href: string) => (
		<a
			className="dashboard-nav-link"
			href={href}
			aria-current={section === kind ? "page" : undefined}
		>
			<NavigationIcon kind={kind} />
			<span>{label}</span>
		</a>
	);
	return (
		<div className="dashboard-shell" lang={locale}>
			<a href="#dashboard-content" className="dashboard-skip">
				{copy.skip}
			</a>
			<header className="dashboard-mobile-bar">
				<span className="dashboard-brand">
					<span className="dashboard-brand-mark" aria-hidden="true">
						<NavigationIcon kind="projects" />
					</span>
					{name}
				</span>
				<button
					type="button"
					className="dashboard-icon-button"
					aria-label={copy.menu}
					aria-expanded={open}
					aria-controls="dashboard-sidebar"
					onClick={() => setOpen(!open)}
					onKeyDown={(event) => {
						if (event.key === "Escape") setOpen(false);
					}}
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						aria-hidden="true"
					>
						<path
							d={open ? "m6 6 12 12M6 18 18 6" : "M4 6h16M4 12h16M4 18h16"}
						/>
					</svg>
				</button>
			</header>
			<aside
				id="dashboard-sidebar"
				className={`dashboard-sidebar${open ? " is-open" : ""}`}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						setOpen(false);
						document
							.querySelector<HTMLButtonElement>(".dashboard-mobile-bar button")
							?.focus();
					}
				}}
			>
				<a
					className="dashboard-brand dashboard-desktop-brand"
					href={`/${locale}/account`}
				>
					<span className="dashboard-brand-mark" aria-hidden="true">
						<NavigationIcon kind="projects" />
					</span>
					<span>{name}</span>
				</a>
				<div className="dashboard-org-switch">
					<label htmlFor="dashboard-organization">{copy.context}</label>
					<select
						id="dashboard-organization"
						value={organizationId ?? ""}
						disabled={state === "loading" || pendingMfa}
						onChange={(event) => {
							if (event.target.value)
								window.location.assign(
									`/${locale}/organizations/${event.target.value}${section === "projects" ? "/projects" : section === "customers" ? "/customers" : ""}`,
								);
						}}
					>
						<option value="" disabled={Boolean(organizationId)}>
							{state === "loading" ? copy.loading : copy.choose}
						</option>
						{organizationId && !current && (
							<option value={organizationId}>{copy.selected}</option>
						)}
						{organizations.map((item) => (
							<option key={item.id} value={item.id}>
								{item.name}
							</option>
						))}
					</select>
					{state === "error" && (
						<p className="dashboard-sidebar-note">
							{copy.failed}{" "}
							<button type="button" className="underline" onClick={onRetry}>
								{copy.retry}
							</button>
						</p>
					)}
				</div>
				<nav aria-label={copy.navigation}>
					{organizationId && (
						<>
							<p className="dashboard-nav-label">{copy.work}</p>
							{link("projects", copy.projects, `${organizationPath}/projects`)}
							{link(
								"customers",
								copy.customers,
								`${organizationPath}/customers`,
							)}
							{link("organization", copy.settings, organizationPath)}
						</>
					)}
					<p className="dashboard-nav-label">{copy.personal}</p>
					{link("account", copy.account, `/${locale}/account`)}
					{!pendingMfa && (
						<a
							className="dashboard-manage-link"
							href={`/${locale}/account#organizations`}
						>
							{copy.manage}
							<span aria-hidden="true">↗</span>
						</a>
					)}
				</nav>
				<div className="dashboard-sidebar-footer">
					{user && (
						<a href={`/${locale}/account`} className="dashboard-user">
							<span className="dashboard-avatar" aria-hidden="true">
								{(user.name || user.email).slice(0, 1).toUpperCase()}
							</span>
							<span>
								<strong>{user.name || copy.account}</strong>
								<small>{user.email}</small>
							</span>
						</a>
					)}
					<div className="dashboard-preferences">
						<label className="sr-only" htmlFor="dashboard-language">
							{copy.language}
						</label>
						<select
							id="dashboard-language"
							value={locale}
							onChange={(event) => {
								if (onLocaleChange) {
									onLocaleChange(event.target.value === "es" ? "es" : "en");
									return;
								}
								const url = new URL(window.location.href);
								url.pathname = url.pathname.replace(
									/^\/(en|es)(?=\/|$)/,
									`/${event.target.value}`,
								);
								window.location.assign(url.href);
							}}
						>
							<option value="en" lang="en">
								English
							</option>
							<option value="es" lang="es">
								Español
							</option>
						</select>
					</div>
				</div>
			</aside>
			<div className="dashboard-body">
				<div className="dashboard-location">
					<span>
						{section === "account"
							? copy.personal
							: (current?.name ?? copy.selected)}
					</span>
					<span aria-hidden="true">/</span>
					<strong>{copy[section]}</strong>
				</div>
				<main
					id="dashboard-content"
					tabIndex={-1}
					className="dashboard-content"
				>
					{children}
				</main>
			</div>
		</div>
	);
}
