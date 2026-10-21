"use client";

import { createApiClient } from "@saas-cook/api/client";
import { Button, NativeSelect, NativeSelectOption } from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { NotificationCenter } from "../features/notifications/notification-center";
import { dashboardMessages } from "../i18n/dashboard";
import { resolveLocale } from "../i18n/locales";
import { identityClient } from "../lib/identity-client";
import "./dashboard.css";
import { UserAvatar } from "./user-avatar";

const AppName = createContext("SaaS Cook");
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
	kind:
		| "account"
		| "organization"
		| "projects"
		| "customers"
		| "billing"
		| "usage"
		| "search"
		| "keys"
		| "data"
		| "settings"
		| "privacy";
}) {
	const icons = {
		account: (
			<>
				<circle cx="12" cy="8" r="3.5" />
				<path d="M5 21v-3a7 7 0 0 1 14 0v3" />
			</>
		),
		organization: (
			<path d="M4 21V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v17M2 21h20M9 21v-5h6v5M8 7h2m4 0h2M8 11h2m4 0h2" />
		),
		projects: (
			<>
				<rect x="3" y="3" width="7" height="7" rx="1.5" />
				<rect x="14" y="3" width="7" height="7" rx="1.5" />
				<rect x="3" y="14" width="7" height="7" rx="1.5" />
				<rect x="14" y="14" width="7" height="7" rx="1.5" />
			</>
		),
		customers: (
			<>
				<circle cx="9" cy="8" r="3" />
				<path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2" />
			</>
		),
		billing: (
			<>
				<rect x="2" y="4" width="20" height="16" rx="2" />
				<path d="M2 9h20M6 15h4" />
			</>
		),
		usage: <path d="M3 3v18h18M7 17v-5M12 17V8M17 17V4" />,
		search: (
			<>
				<circle cx="10.5" cy="10.5" r="7.5" />
				<path d="m16 16 5 5" />
			</>
		),
		keys: (
			<>
				<circle cx="7.5" cy="15.5" r="4.5" />
				<path d="m11 12 9-9h2v4h-3v3h-3l-2 2" />
			</>
		),
		data: <path d="M8 3v14m-5-5 5 5 5-5M16 21V7m-5 5 5-5 5 5" />,
		settings: (
			<>
				<path d="M4 3v8m0 6v4M12 3v2m0 6v10M20 3v10m0 6v2" />
				<circle cx="4" cy="14" r="3" />
				<circle cx="12" cy="8" r="3" />
				<circle cx="20" cy="16" r="3" />
			</>
		),
		privacy: (
			<>
				<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z" />
				<path d="m8 12 3 3 5-6" />
			</>
		),
	};
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
			{icons[kind]}
		</svg>
	);
}

export function DashboardShell({
	section,
	organizationId,
	children,
	onLocaleChange,
}: {
	section:
		| "account"
		| "organization"
		| "projects"
		| "customers"
		| "billing"
		| "usage"
		| "search"
		| "keys"
		| "data"
		| "settings"
		| "privacy";
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
	section:
		| "account"
		| "organization"
		| "projects"
		| "customers"
		| "billing"
		| "usage"
		| "search"
		| "keys"
		| "data"
		| "settings"
		| "privacy";
	organizationId?: string;
	children: ReactNode;
	organizations: Array<{ id: string; name: string }>;
	state: "loading" | "ready" | "error";
	pendingMfa?: boolean;
	user?: {
		id?: string;
		name?: string | null;
		email: string;
		image?: string | null;
	};
	onRetry: () => void;
	onLocaleChange?: (locale: "en" | "es") => void;
}) {
	const locale = resolveLocale(useLocale());
	const copy = dashboardMessages[locale];
	const phase6 = useTranslations("Navigation");
	const sectionLabel =
		section === "search" ||
		section === "keys" ||
		section === "data" ||
		section === "privacy"
			? phase6(section)
			: copy[section];
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
				<Button
					variant="ghost"
					size="plain"
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
				</Button>
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
					<NativeSelect
						id="dashboard-organization"
						value={organizationId ?? ""}
						disabled={state === "loading" || pendingMfa}
						onChange={(event) => {
							if (event.target.value)
								window.location.assign(
									`/${locale}/organizations/${event.target.value}${section === "projects" ? "/projects" : section === "customers" ? "/customers" : section === "billing" ? "/billing" : section === "usage" ? "/usage" : section === "search" ? "/search" : section === "keys" ? "/keys" : section === "data" ? "/data" : section === "settings" ? "/settings" : section === "privacy" ? "/privacy" : ""}`,
								);
						}}
					>
						<NativeSelectOption value="" disabled={Boolean(organizationId)}>
							{state === "loading" ? copy.loading : copy.choose}
						</NativeSelectOption>
						{organizationId && !current && (
							<NativeSelectOption value={organizationId}>
								{copy.selected}
							</NativeSelectOption>
						)}
						{organizations.map((item) => (
							<NativeSelectOption key={item.id} value={item.id}>
								{item.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
					{state === "error" && (
						<p className="dashboard-sidebar-note">
							{copy.failed}{" "}
							<Button
								variant="ghost"
								size="plain"
								type="button"
								className="underline"
								onClick={onRetry}
							>
								{copy.retry}
							</Button>
						</p>
					)}
				</div>
				<nav aria-label={copy.navigation}>
					{organizationId && (
						<>
							<p className="dashboard-nav-label">{copy.work}</p>
							{link("search", phase6("search"), `${organizationPath}/search`)}
							{link("projects", copy.projects, `${organizationPath}/projects`)}
							{link(
								"customers",
								copy.customers,
								`${organizationPath}/customers`,
							)}
							{link("billing", copy.billing, `${organizationPath}/billing`)}
							{link("usage", copy.usage, `${organizationPath}/usage`)}
							{link("keys", phase6("keys"), `${organizationPath}/keys`)}
							{link("data", phase6("data"), `${organizationPath}/data`)}
							{link(
								"settings",
								phase6("settings"),
								`${organizationPath}/settings`,
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
						<>
							<div className="dashboard-footer-links">
								<a href={`/${locale}/privacy`}>{phase6("privacy")}</a>
								<a href={`/${locale}/help`}>{phase6("help")}</a>
							</div>
							<a href={`/${locale}/account`} className="dashboard-user">
								<UserAvatar user={user} />
								<span>
									<strong>{user.name || copy.account}</strong>
									<small>{user.email}</small>
								</span>
							</a>
						</>
					)}
					<div className="dashboard-preferences">
						<label className="sr-only" htmlFor="dashboard-language">
							{copy.language}
						</label>
						<NativeSelect
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
							<NativeSelectOption value="en" lang="en">
								English
							</NativeSelectOption>
							<NativeSelectOption value="es" lang="es">
								Español
							</NativeSelectOption>
						</NativeSelect>
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
					<strong>{sectionLabel}</strong>
				</div>
				<main
					id="dashboard-content"
					tabIndex={-1}
					className="dashboard-content"
				>
					{children}
					<NotificationCenter organizationId={organizationId} />
				</main>
			</div>
		</div>
	);
}
