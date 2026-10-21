"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { createApiClient } from "@saas-cook/api/client";
import { Button, Input } from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PrivacySettings } from "../features/privacy/page";
import { accountDashboardMessages } from "../i18n/account-dashboard";
import { identityClient } from "../lib/identity-client";
import { IdentityRequestError, identityRequest } from "../lib/identity-request";
import { AuthFrame, AuthHeader } from "./auth-ui";
import { DashboardShell } from "./dashboard-shell";
import {
	AppearanceSettings,
	ProfilePictureControls,
} from "./personal-settings";
import { SignIn } from "./sign-in";
import { UserAvatar } from "./user-avatar";
import "./account-dashboard.css";

type AccountSession = {
	id: string;
	token: string;
	createdAt: Date;
	expiresAt: Date;
};
type Notice = {
	scope: string;
	text: string;
	kind: "success" | "error";
	reauthenticate?: boolean;
};
type AccountSection =
	| "identity"
	| "organizations"
	| "privacy"
	| "security"
	| "sessions";

export function Account() {
	const t = useTranslations("Account");
	const navigation = useTranslations("Navigation");
	const locale = useLocale();
	const copy = accountDashboardMessages[locale === "es" ? "es" : "en"];
	const { data: session, isPending, refetch } = identityClient.useSession();
	const [sessionLoaded, setSessionLoaded] = useState(false);
	useEffect(() => {
		if (!isPending) setSessionLoaded(true);
	}, [isPending]);
	const pendingMfa = Boolean(
		session?.user.twoFactorEnabled &&
			!(session.session as { mfa?: boolean }).mfa,
	);
	const [section, setSection] = useState<AccountSection>("identity");
	const activeSection =
		pendingMfa &&
		(section === "organizations" ||
			section === "privacy" ||
			section === "sessions")
			? "security"
			: section;
	const tabs = [
		{ id: "identity", label: copy.identity },
		...(!pendingMfa
			? [
					{ id: "organizations", label: t("organizations") } as const,
					{ id: "privacy", label: navigation("privacy") } as const,
				]
			: []),
		{ id: "security", label: t("security") },
		...(!pendingMfa ? [{ id: "sessions", label: t("sessions") } as const] : []),
	] satisfies Array<{ id: AccountSection; label: string }>;
	useEffect(() => {
		function readSection() {
			const hash = window.location.hash.slice(1);
			if (hash === "identity" || hash === "security") setSection(hash);
			else if (
				hash === "organizations" ||
				hash === "privacy" ||
				hash === "sessions"
			)
				setSection(pendingMfa ? "security" : hash);
			else if (hash === "reauthenticate") setSection("security");
			else if (!hash) setSection(pendingMfa ? "security" : "identity");
		}
		readSection();
		// Put the required verification form in view when sign-in needs MFA.
		if (pendingMfa) setSection("security");
		window.addEventListener("hashchange", readSection);
		return () => window.removeEventListener("hashchange", readSection);
	}, [pendingMfa]);
	function selectSection(next: AccountSection) {
		setSection(next);
		window.history.replaceState(window.history.state, "", `#${next}`);
	}
	const accountId = session?.user.id;
	const previousAccount = useRef(accountId);
	const sessionId = session?.session.id;
	const currentIdentity = `${accountId ?? ""}:${sessionId ?? ""}:${pendingMfa}`;
	const identity = useRef(currentIdentity);
	identity.current = currentIdentity;
	const mounted = useRef(false);
	const refreshGeneration = useRef(0);
	const submitting = useRef(false);
	const organizationAttempt = useRef<{ payload: string; key: string } | null>(
		null,
	);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [busyScope, setBusyScope] = useState<string | null>(null);
	const busy = busyScope !== null;
	const [loading, setLoading] = useState(true);
	const [loadFailed, setLoadFailed] = useState(false);
	const [organizations, setOrganizations] = useState<
		Array<{ id: string; name: string; slug: string }>
	>([]);
	const [keys, setKeys] = useState<Array<{ id: string; name?: string | null }>>(
		[],
	);
	const [sessions, setSessions] = useState<AccountSession[]>([]);
	const [sessionReauthRequired, setSessionReauthRequired] = useState(false);
	const [mfaSetup, setMfaSetup] = useState<{
		totpURI?: string;
		backupCodes: string[];
	} | null>(null);
	const organizationForm = useForm<{ name: string; slug: string }>({
		resolver: zodResolver(
			z.object({
				name: z
					.string()
					.trim()
					.min(1, copy.nameInvalid)
					.max(80, copy.nameInvalid),
				slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, copy.slugInvalid),
			}),
		),
		defaultValues: { name: "", slug: "" },
	});
	const resetOrganization = organizationForm.reset;
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			refreshGeneration.current += 1;
		};
	}, []);
	const refresh = useCallback(async () => {
		const generation = ++refreshGeneration.current;
		const expectedIdentity = identity.current;
		if (!accountId || !sessionId || pendingMfa) {
			setOrganizations([]);
			setKeys([]);
			setSessions([]);
			setSessionReauthRequired(false);
			setLoading(false);
			return;
		}
		setLoading(true);
		setLoadFailed(false);
		const current = () =>
			mounted.current &&
			generation === refreshGeneration.current &&
			expectedIdentity === identity.current;
		try {
			const api = createApiClient(`${window.location.origin}/api/rpc`);
			const [nextOrganizations, credentials, activeSessions] =
				await Promise.all([
					api.organizations.list({}),
					identityClient.passkey.listUserPasskeys(),
					identityClient.listSessions(),
				]);
			if (!current()) return;
			// Session inventory requires a recent sign-in; an older, valid session
			// can still load organizations and passkeys.
			const reauthRequired =
				activeSessions.error?.status === 403 &&
				activeSessions.error.code === "SESSION_NOT_FRESH";
			if (credentials.error || (activeSessions.error && !reauthRequired))
				throw new Error("account");
			setOrganizations(nextOrganizations);
			setKeys(credentials.data ?? []);
			setSessions(activeSessions.data ?? []);
			setSessionReauthRequired(reauthRequired);
		} catch {
			if (current()) setLoadFailed(true);
		} finally {
			if (current()) setLoading(false);
		}
	}, [accountId, sessionId, pendingMfa]);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useEffect(() => {
		// Never retain setup secrets or another account's inventory across identities.
		if (previousAccount.current === accountId) return;
		previousAccount.current = accountId;
		setMfaSetup(null);
		setNotice(null);
		setOrganizations([]);
		setKeys([]);
		setSessions([]);
		setSessionReauthRequired(false);
		organizationAttempt.current = null;
		resetOrganization();
	}, [accountId, resetOrganization]);

	async function perform(
		scope: string,
		action: (isCurrent: () => boolean) => Promise<unknown>,
		success = t("saved"),
	) {
		if (submitting.current) return false;
		const expectedIdentity = identity.current;
		const isCurrent = () =>
			mounted.current && identity.current === expectedIdentity;
		submitting.current = true;
		setBusyScope(scope);
		setNotice(null);
		try {
			await action(isCurrent);
			if (isCurrent()) setNotice({ scope, text: success, kind: "success" });
			return true;
		} catch (error) {
			const status =
				error instanceof IdentityRequestError
					? error.status
					: (error as { status?: number }).status;
			const code = (error as { code?: string }).code;
			const reauthenticate =
				status === 401 ||
				status === 403 ||
				code === "UNAUTHORIZED" ||
				code === "FORBIDDEN";
			const unavailable = status === 503 || code === "SERVICE_UNAVAILABLE";
			const conflict = status === 409 || code === "CONFLICT";
			const verificationFailed =
				status === 400 && (scope === "verify" || scope === "recovery");
			const capacity = error instanceof Error && error.message === "CAPACITY";
			if (isCurrent())
				setNotice({
					scope,
					kind: "error",
					reauthenticate,
					text: unavailable
						? t("unavailable")
						: reauthenticate
							? copy.reauthRequired
							: conflict && scope === "organizations"
								? copy.organizationConflict
								: status === 429
									? t("tooManyRequests")
									: verificationFailed
										? copy.verificationFailed
										: capacity
											? t("capacityDenied")
											: t("failed"),
				});
			return false;
		} finally {
			submitting.current = false;
			if (mounted.current) setBusyScope(null);
		}
	}
	async function passkeySignIn() {
		const result = await identityClient.signIn.passkey();
		if (result.error) throw new IdentityRequestError(result.error.status);
		await refetch();
	}
	function feedback(scope: string) {
		if (busyScope === scope)
			return (
				<p className="account-setting-description" role="status">
					{copy.working}
				</p>
			);
		if (notice?.scope !== scope) return null;
		return (
			<div
				className={`dashboard-notice account-feedback ${notice.kind === "error" ? "account-feedback-error" : ""}`}
				role={notice.kind === "error" ? "alert" : "status"}
				aria-atomic="true"
			>
				{notice.text}
				{notice.reauthenticate && (
					<a className="ml-2" href="#reauthenticate">
						{copy.reauthenticateTitle}
					</a>
				)}
			</div>
		);
	}
	function date(value: Date) {
		return new Intl.DateTimeFormat(locale, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(value));
	}
	// Background session refreshes must not remount forms and discard typed input.
	if (isPending && !sessionLoaded)
		return (
			<AuthFrame locale={locale === "es" ? "es" : "en"} showLocaleSwitch>
				<AuthHeader
					title={t("signInTitle")}
					description={t("signInDescription")}
				/>
				<p
					role="status"
					className="py-12 text-center text-sm text-muted-foreground"
				>
					{t("loading")}
				</p>
			</AuthFrame>
		);
	if (!session)
		return <SignIn refreshSession={refetch} passkeySignIn={passkeySignIn} />;
	return (
		<DashboardShell section="account">
			<div className="account-dashboard">
				<header className="dashboard-page-header">
					<div>
						<p className="dashboard-eyebrow">{copy.personal}</p>
						<h1>{t("title")}</h1>
						<p className="dashboard-description">{copy.description}</p>
					</div>
				</header>
				<div
					className="dashboard-subnav"
					role="tablist"
					aria-label={copy.accountSections}
				>
					{tabs.map((tab, index) => (
						<Button
							variant="ghost"
							size="plain"
							type="button"
							role="tab"
							key={tab.id}
							id={`account-tab-${tab.id}`}
							aria-controls={tab.id}
							aria-selected={activeSection === tab.id}
							tabIndex={activeSection === tab.id ? 0 : -1}
							onClick={() => selectSection(tab.id)}
							onKeyDown={(event) => {
								let next = index;
								if (event.key === "ArrowRight")
									next = (index + 1) % tabs.length;
								else if (event.key === "ArrowLeft")
									next = (index + tabs.length - 1) % tabs.length;
								else if (event.key === "Home") next = 0;
								else if (event.key === "End") next = tabs.length - 1;
								else return;
								event.preventDefault();
								const target = tabs[next];
								if (target) {
									selectSection(target.id);
									document.getElementById(`account-tab-${target.id}`)?.focus();
								}
							}}
						>
							{tab.label}
						</Button>
					))}
				</div>
				<div
					className="dashboard-section"
					id="identity"
					role="tabpanel"
					aria-labelledby="account-tab-identity"
					hidden={activeSection !== "identity"}
				>
					<div className="account-section-intro">
						<div>
							<h2 id="identity-title">{copy.identity}</h2>
							<p>{copy.identityDescription}</p>
						</div>
					</div>
					<div className="account-identity-row">
						<UserAvatar user={session.user} className="account-avatar" />
						<div className="account-identity-text">
							<strong>{session.user.name || session.user.email}</strong>
							<p className="account-setting-description">
								{session.user.email}
							</p>
						</div>
						{session.user.emailVerified && (
							<span className="dashboard-badge">{copy.verified}</span>
						)}
						<Button
							className="dashboard-secondary"
							disabled={busy}
							onClick={() =>
								void perform("identity", async (isCurrent) => {
									const result = await identityClient.signOut();
									if (result.error)
										throw new IdentityRequestError(result.error.status);
									if (!isCurrent()) return;
									refreshGeneration.current += 1;
									setOrganizations([]);
									setKeys([]);
									setSessions([]);
									setMfaSetup(null);
									await refetch();
								})
							}
						>
							{t("signOut")}
						</Button>
					</div>
					{!pendingMfa && <ProfilePictureControls key={currentIdentity} />}
					{feedback("identity")}
					{!pendingMfa && <AppearanceSettings />}
				</div>
				{pendingMfa ? (
					<p role="alert" className="dashboard-notice">
						{t("mfaRequired")}
					</p>
				) : (
					<>
						{loading && (
							<p role="status" className="account-setting-description">
								{t("loading")}
							</p>
						)}
						{loadFailed && (
							<div className="dashboard-notice" role="alert">
								<p>{copy.loadFailed}</p>
								<Button
									className="dashboard-secondary mt-3"
									disabled={busy || loading}
									onClick={() => void refresh()}
								>
									{copy.retry}
								</Button>
							</div>
						)}
						<div
							className="dashboard-section"
							id="organizations"
							role="tabpanel"
							aria-labelledby="account-tab-organizations"
							hidden={activeSection !== "organizations"}
						>
							<div className="account-section-intro">
								<div>
									<h2 id="organizations-title">{t("organizations")}</h2>
									<p>{copy.organizationsDescription}</p>
								</div>
							</div>
							{!loading && !loadFailed && organizations.length === 0 && (
								<p className="dashboard-empty">{t("noOrganizations")}</p>
							)}
							<ul className="account-org-list">
								{organizations.map((organization) => (
									<li key={organization.id}>
										<a
											className="account-org-link"
											href={`/${locale}/organizations/${organization.id}`}
										>
											<span className="account-avatar" aria-hidden="true">
												{organization.name.slice(0, 2).toUpperCase()}
											</span>
											<span>
												{organization.name}
												<small>{copy.organizationDestination}</small>
											</span>
											<span aria-hidden="true">↗</span>
										</a>
									</li>
								))}
							</ul>
							<h3 className="text-sm font-medium">{t("create")}</h3>
							<p className="account-setting-description">
								{copy.createDescription}
							</p>
							<form
								className="account-create-form"
								noValidate
								aria-busy={busyScope === "organizations"}
								onSubmit={organizationForm.handleSubmit(async (values) => {
									const payload = JSON.stringify(values);
									if (organizationAttempt.current?.payload !== payload)
										organizationAttempt.current = {
											payload,
											key: crypto.randomUUID(),
										};
									const operationKey = organizationAttempt.current.key;
									await perform("organizations", async (isCurrent) => {
										const created = await createApiClient(
											`${window.location.origin}/api/rpc`,
										).organizations.create({ ...values, operationKey });
										if (!isCurrent()) return;
										window.location.assign(
											`/${locale}/organizations/${created.id}`,
										);
									});
								})}
							>
								<div className="grid gap-2">
									<label htmlFor="account-organization-name">
										{t("organizationName")}
									</label>
									<Input
										id="account-organization-name"
										disabled={busy}
										autoComplete="organization"
										aria-invalid={Boolean(
											organizationForm.formState.errors.name,
										)}
										aria-describedby={
											organizationForm.formState.errors.name
												? "account-name-error"
												: undefined
										}
										{...organizationForm.register("name")}
									/>
									{organizationForm.formState.errors.name && (
										<span
											id="account-name-error"
											role="alert"
											className="text-destructive"
										>
											{organizationForm.formState.errors.name.message}
										</span>
									)}
								</div>
								<div className="grid gap-2">
									<label htmlFor="account-organization-slug">{t("slug")}</label>
									<Input
										id="account-organization-slug"
										disabled={busy}
										autoComplete="off"
										spellCheck={false}
										aria-invalid={Boolean(
											organizationForm.formState.errors.slug,
										)}
										aria-describedby={`account-slug-hint${organizationForm.formState.errors.slug ? " account-slug-error" : ""}`}
										{...organizationForm.register("slug")}
									/>
									<span
										id="account-slug-hint"
										className="text-xs font-normal text-muted-foreground"
									>
										{copy.slugHelp}
									</span>
									{organizationForm.formState.errors.slug && (
										<span
											id="account-slug-error"
											role="alert"
											className="text-destructive"
										>
											{organizationForm.formState.errors.slug.message}
										</span>
									)}
								</div>
								<Button disabled={busy} type="submit">
									{busyScope === "organizations" ? copy.working : t("create")}
								</Button>
							</form>
							{feedback("organizations")}
						</div>
						<div
							className="dashboard-section"
							id="privacy"
							role="tabpanel"
							aria-labelledby="account-tab-privacy"
							hidden={activeSection !== "privacy"}
						>
							<PrivacySettings key={currentIdentity} />
						</div>
					</>
				)}
				<div
					className="dashboard-section"
					id="security"
					role="tabpanel"
					aria-labelledby="account-tab-security"
					hidden={activeSection !== "security"}
				>
					<div className="account-section-intro">
						<div>
							<h2 id="security-title">{t("security")}</h2>
							<p>{copy.securityDescription}</p>
						</div>
					</div>
					{!pendingMfa && (
						<div className="account-security-row">
							<div>
								<h3>{copy.passkeys}</h3>
								<p className="account-setting-description">
									{copy.passkeysDescription}
								</p>
							</div>
							<div className="account-security-content">
								{!loading && !loadFailed && keys.length === 0 && (
									<p className="account-setting-description mb-4">
										{copy.noPasskeys}
									</p>
								)}
								<ul className="account-passkey-list">
									{keys.map((key) => (
										<li key={key.id}>
											<span>{key.name ?? t("unnamedPasskey")}</span>
											<Button
												className="dashboard-secondary dashboard-danger"
												disabled={busy}
												onClick={() => {
													if (!window.confirm(copy.passkeyRemoveConfirm))
														return;
													void perform("passkeys", async (isCurrent) => {
														await identityRequest("revoke-passkey", {
															id: key.id,
														});
														if (!isCurrent()) return;
														await refresh();
													});
												}}
											>
												{t("remove")}
											</Button>
										</li>
									))}
								</ul>
								<form
									className="account-inline-form"
									aria-busy={busyScope === "passkeys"}
									onSubmit={(event) => {
										event.preventDefault();
										const form = event.currentTarget;
										const data = new FormData(form);
										void perform("passkeys", async (isCurrent) => {
											const result = await identityClient.passkey.addPasskey({
												name: String(data.get("name")),
											});
											if (result.error)
												throw new IdentityRequestError(result.error.status);
											if (!isCurrent()) return;
											form.reset();
											if (!isCurrent()) return;
											await refresh();
										});
									}}
								>
									<label htmlFor="account-passkey-name" className="grid gap-2">
										{t("passkeyName")}
										<Input
											id="account-passkey-name"
											name="name"
											required
											maxLength={80}
											disabled={busy}
											autoComplete="off"
										/>
									</label>
									<Button
										className="dashboard-secondary"
										disabled={busy}
										type="submit"
									>
										{t("addPasskey")}
									</Button>
								</form>
								{feedback("passkeys")}
							</div>
						</div>
					)}
					<div className="account-security-row">
						<div>
							<h3>{t("mfa")}</h3>
							<p className="account-setting-description">
								{copy.mfaDescription}
							</p>
							<span className="dashboard-badge mt-3">
								{mfaSetup?.totpURI || pendingMfa
									? copy.setupPending
									: session.user.twoFactorEnabled
										? copy.enabled
										: copy.notEnabled}
							</span>
						</div>
						<div className="account-security-content">
							{!pendingMfa && (
								<form
									className="space-y-3"
									aria-busy={busyScope === "mfa"}
									onSubmit={(event) => {
										event.preventDefault();
										const form = event.currentTarget;
										const data = new FormData(form);
										const intent =
											(
												event.nativeEvent as SubmitEvent
											).submitter?.getAttribute("value") ??
											(session.user.twoFactorEnabled ? "codes" : "enable");
										if (
											intent === "disable" &&
											!window.confirm(copy.mfaDisableConfirm)
										)
											return;
										if (
											intent === "codes" &&
											!window.confirm(copy.replaceCodesConfirm)
										)
											return;
										if (intent === "enable" && mfaSetup?.totpURI) return;
										const password = String(data.get("password") ?? "");
										void perform("mfa", async (isCurrent) => {
											const body = password ? { password } : {};
											if (intent === "enable") {
												const result = await identityRequest(
													"two-factor/enable",
													body,
												);
												if (!isCurrent()) return;
												setMfaSetup(result);
											} else if (intent === "codes") {
												const result = await identityRequest(
													"two-factor/generate-backup-codes",
													body,
												);
												if (!isCurrent()) return;
												setMfaSetup({ backupCodes: result.backupCodes });
											} else {
												await identityRequest("two-factor/disable", body);
												if (!isCurrent()) return;
												setMfaSetup(null);
												await refetch();
											}
											if (!isCurrent()) return;
											form.reset();
										});
									}}
								>
									<label htmlFor="mfa-password" className="grid gap-2">
										{t("currentPassword")}
										<Input
											id="mfa-password"
											name="password"
											type="password"
											autoComplete="current-password"
											maxLength={128}
											aria-describedby="mfa-password-help"
											disabled={busy}
										/>
									</label>
									<p
										id="mfa-password-help"
										className="account-setting-description"
									>
										{t("mfaPasswordHelp")}
									</p>
									{session.user.twoFactorEnabled && (
										<p className="account-setting-description">
											{t("mfaDisableHelp")}
										</p>
									)}
									<div className="flex flex-wrap gap-3">
										{!session.user.twoFactorEnabled ? (
											<Button
												className="dashboard-secondary"
												disabled={busy || Boolean(mfaSetup?.totpURI)}
												type="submit"
												value="enable"
											>
												{t("enableMfa")}
											</Button>
										) : (
											<>
												<Button
													className="dashboard-secondary"
													disabled={busy}
													type="submit"
													value="codes"
												>
													{t("newRecoveryCodes")}
												</Button>
												<Button
													className="dashboard-secondary dashboard-danger"
													disabled={busy}
													type="submit"
													value="disable"
												>
													{t("disableMfa")}
												</Button>
											</>
										)}
									</div>
								</form>
							)}
							{feedback("mfa")}
							{mfaSetup && (
								<div className="account-secret">
									<h4>
										{mfaSetup.totpURI
											? copy.setupTitle
											: copy.recoveryCodesTitle}
									</h4>
									<p className="account-setting-description">
										{t(mfaSetup.totpURI ? "mfaSetup" : "recoveryCodesHelp")}
									</p>
									{mfaSetup.totpURI && <code>{mfaSetup.totpURI}</code>}
									<pre>{mfaSetup.backupCodes.join("\n")}</pre>
									<p className="account-setting-description">
										{copy.sensitiveHelp}
									</p>
									{!mfaSetup.totpURI && (
										<Button
											className="dashboard-secondary mt-3"
											disabled={busy}
											onClick={() => setMfaSetup(null)}
										>
											{copy.hideCodes}
										</Button>
									)}
								</div>
							)}
							{(session.user.twoFactorEnabled || mfaSetup?.totpURI) && (
								<div className="mt-5">
									<p className="account-setting-description mb-3">
										{copy.verifyDescription}
									</p>
									<form
										className="account-inline-form"
										aria-busy={busyScope === "verify"}
										onSubmit={(event) => {
											event.preventDefault();
											const form = event.currentTarget;
											const data = new FormData(form);
											void perform("verify", async (isCurrent) => {
												await identityRequest("two-factor/verify-totp", {
													code: data.get("code"),
												});
												if (!isCurrent()) return;
												setMfaSetup(null);
												form.reset();
												await refetch();
											});
										}}
									>
										<label
											htmlFor="account-verification-code"
											className="grid gap-2"
										>
											{t("code")}
											<Input
												id="account-verification-code"
												name="code"
												inputMode="numeric"
												autoComplete="one-time-code"
												pattern="[0-9]{6}"
												maxLength={6}
												required
												disabled={busy}
											/>
										</label>
										<Button disabled={busy} type="submit">
											{t("verify")}
										</Button>
									</form>
									{feedback("verify")}
								</div>
							)}
							{session.user.twoFactorEnabled && (
								<details className="mt-5">
									<summary>{t("useRecoveryCode")}</summary>
									<p className="account-setting-description mb-3">
										{t("recoveryHelp")}
									</p>
									<form
										className="account-inline-form"
										aria-busy={busyScope === "recovery"}
										onSubmit={(event) => {
											event.preventDefault();
											const form = event.currentTarget;
											const data = new FormData(form);
											void perform("recovery", async (isCurrent) => {
												await identityRequest("two-factor/verify-backup-code", {
													code: data.get("code"),
												});
												if (!isCurrent()) return;
												form.reset();
												await refetch();
											});
										}}
									>
										<label
											htmlFor="account-recovery-code"
											className="grid gap-2"
										>
											{t("recoveryCode")}
											<Input
												id="account-recovery-code"
												name="code"
												autoComplete="off"
												required
												disabled={busy}
											/>
										</label>
										<Button disabled={busy} type="submit">
											{t("verify")}
										</Button>
									</form>
									{feedback("recovery")}
								</details>
							)}
						</div>
					</div>
					<div className="account-security-row" id="reauthenticate">
						<div>
							<h3>{copy.reauthenticateTitle}</h3>
							<p className="account-setting-description">
								{t("reauthenticate")}
							</p>
						</div>
						<div className="account-security-content">
							<div className="flex flex-wrap gap-3">
								<Button
									className="dashboard-secondary"
									disabled={busy}
									onClick={() =>
										void perform(
											"reauthenticate",
											passkeySignIn,
											copy.reauthenticated,
										)
									}
								>
									{t("passkey")}
								</Button>
								<Button
									className="dashboard-secondary"
									disabled={busy}
									onClick={() =>
										void perform(
											"reauthenticate",
											() =>
												identityRequest("sign-in/magic-link", {
													email: session.user.email,
													locale,
												}),
											t("sent"),
										)
									}
								>
									{t("signIn")}
								</Button>
							</div>
							{feedback("reauthenticate")}
						</div>
					</div>
				</div>
				{!pendingMfa && (
					<div
						className="dashboard-section"
						id="sessions"
						role="tabpanel"
						aria-labelledby="account-tab-sessions"
						hidden={activeSection !== "sessions"}
					>
						<div className="account-section-intro">
							<div>
								<h2 id="sessions-title">{t("sessions")}</h2>
								<p>{copy.sessionsDescription}</p>
							</div>
						</div>
						{sessionReauthRequired && (
							<div className="dashboard-notice" role="status">
								<p>{copy.sessionsReauthRequired}</p>
								<a className="mt-3 inline-block" href="#reauthenticate">
									{copy.reauthenticateTitle}
								</a>
							</div>
						)}
						<ul className="account-session-list">
							{[...sessions]
								.sort(
									(a, b) =>
										Number(b.id === session.session.id) -
										Number(a.id === session.session.id),
								)
								.map((active) => (
									<li key={active.id}>
										<div>
											<strong>
												{active.id === session.session.id
													? t("currentSession")
													: t("otherSession")}
											</strong>
											<p>
												{copy.signedIn} · {date(active.createdAt)}
												<br />
												{copy.expires} · {date(active.expiresAt)}
											</p>
										</div>
										{active.id === session.session.id ? (
											<span className="dashboard-badge">
												{t("currentSession")}
											</span>
										) : (
											<Button
												className="dashboard-secondary dashboard-danger"
												disabled={busy}
												onClick={() => {
													if (!window.confirm(copy.sessionRevokeConfirm))
														return;
													void perform("sessions", async (isCurrent) => {
														const result = await identityClient.revokeSession({
															token: active.token,
														});
														if (result.error)
															throw new IdentityRequestError(
																result.error.status,
															);
														if (!isCurrent()) return;
														await refresh();
													});
												}}
											>
												{t("revokeSession")}
											</Button>
										)}
									</li>
								))}
						</ul>
						{!loading &&
							!loadFailed &&
							!sessionReauthRequired &&
							sessions.length === 0 && (
								<p className="account-setting-description">{copy.noSessions}</p>
							)}
						{!loading &&
							!loadFailed &&
							sessions.length > 0 &&
							!sessions.some((item) => item.id !== session.session.id) && (
								<p className="account-setting-description mt-4">
									{copy.noOtherSessions}
								</p>
							)}
						{sessions.some((item) => item.id !== session.session.id) && (
							<Button
								className="dashboard-secondary dashboard-danger mt-5"
								disabled={busy}
								onClick={() => {
									if (!window.confirm(copy.sessionsRevokeConfirm)) return;
									void perform("sessions", async (isCurrent) => {
										const result = await identityClient.revokeOtherSessions();
										if (result.error)
											throw new IdentityRequestError(result.error.status);
										if (!isCurrent()) return;
										await refresh();
									});
								}}
							>
								{t("revokeOthers")}
							</Button>
						)}
						{feedback("sessions")}
					</div>
				)}
			</div>
		</DashboardShell>
	);
}
