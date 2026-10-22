"use client";

import type {
	OrganizationLookupInput,
	organizationLookupOutput,
} from "@saas-cook/backoffice-contracts";
import {
	Alert,
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Input,
	NativeSelect,
	NativeSelectOption,
} from "@saas-cook/ui";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";

type LookupResult = ReturnType<typeof organizationLookupOutput.parse>;
type Status = "empty" | "working" | "ready" | "enrolled" | "denied" | "invalid";

function Icon({
	kind,
}: {
	kind: "brand" | "organization" | "key" | "search" | "shield";
}) {
	const paths = {
		brand: (
			<>
				<rect x="3" y="3" width="7" height="7" rx="1.5" />
				<rect x="14" y="3" width="7" height="7" rx="1.5" />
				<rect x="3" y="14" width="7" height="7" rx="1.5" />
				<rect x="14" y="14" width="7" height="7" rx="1.5" />
			</>
		),
		organization: (
			<path d="M4 21V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v17M2 21h20M9 21v-5h6v5M8 7h2m4 0h2M8 11h2m4 0h2" />
		),
		key: (
			<>
				<circle cx="8" cy="15" r="5" />
				<path d="m12 11 8-8h2v4h-3v3h-3" />
			</>
		),
		search: (
			<>
				<circle cx="10.5" cy="10.5" r="6.5" />
				<path d="m16 16 5 5" />
			</>
		),
		shield: (
			<>
				<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Z" />
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
			{paths[kind]}
		</svg>
	);
}

/**
 * Presents the localized staff workspace using shared controls and theme tokens.
 * Props supply form state, validated lookup metadata and action callbacks; this
 * component grants no authority and performs no service requests itself.
 * Returns responsive forms, live feedback and a masked organization overview.
 */
export function BackofficeView({
	busy,
	authenticated,
	checking = false,
	page = "organizations",
	status,
	invitation,
	result,
	form,
	onInvitationChange,
	onSignIn,
	onEnroll,
	onSignOut,
	onLookup,
	onInvalid,
	directory,
}: {
	directory?: ReactNode;
	busy: boolean;
	authenticated: boolean;
	checking?: boolean;
	page?: "organizations" | "staff-access" | "organization-detail";
	status: Status;
	invitation: string;
	result: LookupResult | null;
	form: UseFormReturn<OrganizationLookupInput>;
	onInvitationChange: (value: string) => void;
	onSignIn: () => void;
	onEnroll: () => void;
	onSignOut: () => void;
	onLookup: (values: OrganizationLookupInput) => Promise<void>;
	onInvalid: () => void;
}) {
	const t = useTranslations("Backoffice");
	const locale = useLocale();
	const format = useFormatter();
	const organizations = authenticated && page !== "staff-access";
	const detail = page === "organization-detail";
	const error = status === "denied" || status === "invalid";
	return (
		<div className="bo-shell">
			<a className="bo-skip" href="#bo-content">
				{t("skip")}
			</a>
			<aside className="bo-sidebar" aria-label={t("navigation")}>
				<a className="bo-brand" href={`/${locale}`}>
					<span className="bo-brand-mark">
						<Icon kind="brand" />
					</span>
					<span>
						SaaS Cook<span className="bo-brand-caption">{t("workspace")}</span>
					</span>
				</a>
				<nav aria-label={t("navigation")}>
					{authenticated && (
						<>
							<p className="bo-nav-label">{t("operations")}</p>
							<a
								className="bo-nav-link"
								href={`/${locale}`}
								aria-current={organizations ? "page" : undefined}
							>
								<Icon kind="organization" />
								{t("organizations")}
							</a>
						</>
					)}
					<a
						className="bo-nav-link"
						href={`/${locale}/staff-access`}
						aria-current={!organizations ? "page" : undefined}
					>
						<Icon kind="key" />
						{t("staffAccess")}
					</a>
				</nav>
				<div className="bo-sidebar-footer">
					<Icon kind="shield" />
					<div>
						<strong>{t("staffOnly")}</strong>
						<p>{t("accessNote")}</p>
					</div>
				</div>
			</aside>
			<div className="bo-body">
				<header className="bo-topbar">
					<p>
						{t("workspace")}
						<span aria-hidden="true">/</span>
						<strong>
							{t(organizations ? "organizations" : "staffAccess")}
						</strong>
					</p>
					<div className="bo-language">
						<label className="bo-sr-only" htmlFor="bo-language">
							{t("language")}
						</label>
						<NativeSelect
							id="bo-language"
							value={locale}
							onChange={(event) =>
								window.location.assign(
									`/${event.target.value === "es" ? "es" : "en"}${page === "staff-access" ? "/staff-access" : detail ? window.location.pathname.replace(/^\/(en|es)/, "") : ""}`,
								)
							}
						>
							<NativeSelectOption value="en" lang="en">
								English
							</NativeSelectOption>
							<NativeSelectOption value="es" lang="es">
								Español
							</NativeSelectOption>
						</NativeSelect>
					</div>
				</header>
				<main id="bo-content" className="bo-content" tabIndex={-1}>
					<header className="bo-page-header">
						<div>
							<p className="bo-eyebrow">{t("operations")}</p>
							<h1>
								{t(
									organizations
										? detail
											? "overview"
											: "organizations"
										: authenticated
											? "staffAccess"
											: "title",
								)}
							</h1>
							<p className="bo-description">
								{t(
									organizations
										? detail
											? "overviewDescription"
											: "intro"
										: authenticated
											? "sessionDescription"
											: "signInDescription",
								)}
							</p>
						</div>
						{organizations && (
							<Badge variant="accent">
								<Icon kind="shield" />
								{t("readOnly")}
							</Badge>
						)}
					</header>
					<Alert
						className="bo-feedback"
						variant={
							error
								? "error"
								: status === "ready" || status === "enrolled"
									? "success"
									: "neutral"
						}
						aria-live="polite"
					>
						{t(
							checking
								? "checkingSession"
								: !authenticated && status === "empty"
									? "signedOut"
									: authenticated &&
											page === "staff-access" &&
											status === "empty"
										? "sessionDescription"
										: detail && status === "ready"
											? "detailReady"
											: status,
						)}
					</Alert>
					<div
						className={
							organizations
								? "bo-workspace bo-organizations"
								: "bo-workspace bo-signed-out"
						}
					>
						{organizations && (
							<div className="bo-main-column">
								{detail && (
									<a className="bo-nav-link" href={`/${locale}`}>
										{t("backOrganizations")}
									</a>
								)}
								{!detail && directory}

								{detail && (
									<Card aria-labelledby="overview-title" aria-busy={busy}>
										<CardHeader>
											<div className="bo-section-title">
												<CardTitle id="overview-title" tabIndex={-1}>
													{t("overview")}
												</CardTitle>
												{result && <Badge>{result.lifecycle}</Badge>}
											</div>
											<CardDescription>
												{t("overviewDescription")}
											</CardDescription>
										</CardHeader>
										<CardContent>
											{result ? (
												<div className="bo-result">
													<h3>{result.name}</h3>
													<dl className="bo-details">
														<div>
															<dt>{t("organization")}</dt>
															<dd>
																<code>{result.id}</code>
															</dd>
														</div>
														<div>
															<dt>{t("lifecycle")}</dt>
															<dd>{result.lifecycle}</dd>
														</div>
														<div>
															<dt>{t("seatLabel")}</dt>
															<dd>
																{t("seats", {
																	occupied: result.seats.occupied,
																	capacity:
																		result.seats.capacity ?? t("unlimited"),
																})}
															</dd>
														</div>
														<div>
															<dt>{t("timestamp")}</dt>
															<dd>
																<time dateTime={result.sourceTimestamp}>
																	{format.dateTime(
																		new Date(result.sourceTimestamp),
																		{
																			dateStyle: "medium",
																			timeStyle: "medium",
																			timeZone: "UTC",
																		},
																	)}{" "}
																	UTC
																</time>
															</dd>
														</div>
														<div>
															<dt>{t("audit")}</dt>
															<dd>
																<code>{result.auditReference}</code>
															</dd>
														</div>
													</dl>
												</div>
											) : (
												<div className="bo-empty">
													<span className="bo-empty-icon">
														<Icon kind="organization" />
													</span>
													<h3>{t(busy ? "working" : "empty")}</h3>
													<p>{t("emptyHelp")}</p>
												</div>
											)}
										</CardContent>
									</Card>
								)}
								<details
									className="bo-lookup-shortcut"
									open={detail ? !result : undefined}
								>
									<summary>
										{t(detail ? "detailCase" : "lookupShortcut")}
									</summary>{" "}
									<Card id="organization-lookup" aria-labelledby="lookup-title">
										<CardHeader>
											<CardTitle id="lookup-title">
												{t("lookupTitle")}
											</CardTitle>
											<CardDescription>
												{t("lookupDescription")}
											</CardDescription>
										</CardHeader>
										<CardContent>
											<form
												className="bo-form"
												noValidate
												aria-busy={busy}
												onSubmit={form.handleSubmit(onLookup, onInvalid)}
											>
												<div className="bo-field">
													<label htmlFor="organization">
														{t("organization")}
													</label>
													<Input
														id="organization"
														readOnly={detail}
														disabled={busy}
														required
														autoCapitalize="none"
														spellCheck={false}
														placeholder="00000000-0000-4000-8000-000000000000"
														{...form.register("organizationId")}
														aria-invalid={
															!!form.formState.errors.organizationId
														}
														aria-describedby={
															form.formState.errors.organizationId
																? "organization-error"
																: "organization-help"
														}
													/>
													{form.formState.errors.organizationId ? (
														<p
															id="organization-error"
															className="bo-field-error"
														>
															{t("organizationError")}
														</p>
													) : (
														<p id="organization-help" className="bo-field-help">
															{t("organizationHelp")}
														</p>
													)}
												</div>
												<div className="bo-field">
													<label htmlFor="case">{t("case")}</label>
													<Input
														id="case"
														disabled={busy}
														required
														maxLength={80}
														autoCapitalize="none"
														spellCheck={false}
														placeholder="SUPPORT-1234"
														{...form.register("caseReference")}
														aria-invalid={!!form.formState.errors.caseReference}
														aria-describedby={
															form.formState.errors.caseReference
																? "case-error"
																: "case-help"
														}
													/>
													{form.formState.errors.caseReference ? (
														<p id="case-error" className="bo-field-error">
															{t("caseError")}
														</p>
													) : (
														<p id="case-help" className="bo-field-help">
															{t("caseHelp")}
														</p>
													)}
												</div>
												<div className="bo-form-actions">
													<Button
														type="submit"
														disabled={busy}
														aria-busy={busy}
													>
														<Icon kind="search" />
														<span>{t("lookup")}</span>
													</Button>
													<span className="bo-form-note">{t("audited")}</span>
												</div>
											</form>
										</CardContent>
									</Card>
								</details>
							</div>
						)}
						{!organizations && (
							<Card
								id="staff-access"
								className="bo-access"
								aria-labelledby="access-title"
							>
								<CardHeader>
									<div className="bo-access-icon">
										<Icon kind="key" />
									</div>
									<CardTitle id="access-title">{t("staffAccess")}</CardTitle>
									<CardDescription>
										{t(
											authenticated
												? "sessionDescription"
												: "signInDescription",
										)}
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="bo-auth-actions">
										{!authenticated && (
											<Button disabled={busy} onClick={onSignIn}>
												<Icon kind="key" />
												{t("signIn")}
											</Button>
										)}
										{authenticated && (
											<Button
												variant="secondary"
												disabled={busy}
												onClick={onSignOut}
											>
												{t("signOut")}
											</Button>
										)}
									</div>
									{!authenticated && (
										<div className="bo-enrollment">
											<h3>{t("newStaff")}</h3>
											<p className="bo-field-help" id="invitation-help">
												{t("enrollmentHelp")}
											</p>
											<div className="bo-field">
												<label htmlFor="invitation">{t("invitation")}</label>
												<Input
													id="invitation"
													disabled={busy}
													type="password"
													autoComplete="off"
													aria-describedby="invitation-help"
													value={invitation}
													onChange={(event) =>
														onInvitationChange(event.target.value)
													}
												/>
											</div>
											<Button
												variant="secondary"
												disabled={busy || !invitation}
												onClick={onEnroll}
											>
												{t("enroll")}
											</Button>
										</div>
									)}
								</CardContent>
							</Card>
						)}
					</div>
				</main>
			</div>
		</div>
	);
}
