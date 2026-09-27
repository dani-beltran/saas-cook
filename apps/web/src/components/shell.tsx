"use client";

import { SampleForm } from "@common-saas/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

const demoOrganizations = [
	{ id: "demo-north", name: "North Studio" },
	{ id: "demo-south", name: "South Workshop" },
] as const;

export function Shell({ appName }: { appName: string }) {
	const t = useTranslations("Shell");
	const locale = useLocale();
	const [organization, setOrganization] = useState<string>(
		demoOrganizations[0].id,
	);
	const currentOrganization = demoOrganizations.find(
		(item) => item.id === organization,
	);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<a
				className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:m-3 focus:rounded focus:bg-card focus:p-3"
				href="#main-content"
			>
				{t("skip")}
			</a>
			<div className="mx-auto grid min-h-screen max-w-[1600px] lg:grid-cols-[240px_1fr]">
				<aside className="border-b border-border bg-card p-5 lg:border-r lg:border-b-0 lg:p-7">
					<a
						href={`/${locale}`}
						className="flex items-center gap-3 text-lg font-semibold tracking-tight"
					>
						<span
							className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"
							aria-hidden="true"
						>
							c.
						</span>
						{appName}
					</a>
					<p className="mt-10 hidden text-xs font-medium uppercase tracking-widest text-muted-foreground lg:block">
						{t("navigation")}
					</p>
					<nav className="mt-4" aria-label={t("navigation")}>
						<a
							aria-current="page"
							href={`/${locale}`}
							className="flex items-center gap-3 rounded-md bg-muted px-3 py-2 text-sm font-medium"
						>
							<span aria-hidden="true">▦</span>
							{t("overview")}
						</a>
					</nav>
				</aside>
				<div className="min-w-0">
					<header className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-card px-6 py-4 lg:px-10">
						<div className="grid gap-1.5">
							<label
								className="text-xs font-medium text-muted-foreground"
								htmlFor="demo-organization"
							>
								{t("organization")}
							</label>
							<select
								className="min-h-10 rounded-md border border-input px-3 text-sm"
								id="demo-organization"
								value={organization}
								onChange={(event) => setOrganization(event.target.value)}
							>
								{demoOrganizations.map((item) => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
							</select>
						</div>
						<div className="flex items-end gap-3">
							<div className="grid gap-1.5">
								<label
									className="text-xs font-medium text-muted-foreground"
									htmlFor="locale"
								>
									{t("language")}
								</label>
								<select
									className="min-h-10 rounded-md border border-input px-3 text-sm"
									id="locale"
									value={locale}
									onChange={(event) => {
										window.location.assign(`/${event.target.value}/patterns`);
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
					</header>
					<main
						id="main-content"
						tabIndex={-1}
						className="mx-auto max-w-5xl px-6 py-10 outline-none lg:px-10 lg:py-14"
					>
						<p className="text-xs font-semibold uppercase tracking-widest text-primary">
							{t("foundation")}
						</p>
						<h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
							{t("title")}
						</h1>
						<p className="mt-3 text-muted-foreground">{t("subtitle")}</p>
						<p className="mt-7 rounded-lg border border-border bg-muted px-4 py-3 text-sm leading-relaxed">
							{t("notice")}
						</p>
						<div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
							<section
								className="rounded-xl border border-border bg-card p-6 sm:p-8"
								aria-labelledby="form-title"
							>
								<h2
									id="form-title"
									className="text-xl font-semibold tracking-tight"
								>
									{t("patternTitle")}
								</h2>
								<p className="mt-2 mb-7 text-sm leading-relaxed text-muted-foreground">
									{t("patternDescription")}
								</p>
								{/* Remount all organization-scoped form state, errors and announcements. */}
								<SampleForm key={`${organization}:${locale}`} />
							</section>
							<aside
								className="rounded-xl border border-border bg-card p-6"
								aria-labelledby="ready-title"
							>
								<p className="text-xs text-muted-foreground">
									{t("activeOrganization")}
								</p>
								<p
									className="mt-2 font-semibold"
									data-testid="current-organization"
								>
									{currentOrganization?.name}
								</p>
								<div className="my-5 border-t border-border" />
								<h2 id="ready-title" className="font-semibold">
									{t("ready")}
								</h2>
								<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
									{t("readyDescription")}
								</p>
							</aside>
						</div>
						<p className="mt-6 text-xs text-muted-foreground">
							{t("localOnly")}
						</p>
					</main>
				</div>
			</div>
		</div>
	);
}
