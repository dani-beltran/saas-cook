"use client";
import { createApiClient } from "@common-saas/api/client";
import { Button, Input } from "@common-saas/ui";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { identityClient } from "../lib/identity-client";

async function identityRequest(path: string, body: unknown) {
	const response = await fetch(`/api/auth/${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error("identity_failed");
	return response.json();
}
type AccountSession = {
	id: string;
	token: string;
	createdAt: Date;
	expiresAt: Date;
};
export function Account() {
	const t = useTranslations("Account");
	const locale = useLocale();
	const { data: session, isPending, refetch } = identityClient.useSession();
	const pendingMfa = Boolean(
		session?.user.twoFactorEnabled &&
			!(session.session as { mfa?: boolean }).mfa,
	);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [organizations, setOrganizations] = useState<
		Array<{ id: string; name: string; slug: string }>
	>([]);
	const [keys, setKeys] = useState<Array<{ id: string; name?: string | null }>>(
		[],
	);
	const [sessions, setSessions] = useState<AccountSession[]>([]);
	const [mfaSetup, setMfaSetup] = useState<{
		totpURI?: string;
		backupCodes: string[];
	} | null>(null);
	const refresh = useCallback(async () => {
		if (pendingMfa) {
			setOrganizations([]);
			setKeys([]);
			setSessions([]);
			return;
		}
		const api = createApiClient(`${window.location.origin}/api/rpc`);
		const [organizations, credentials, activeSessions] = await Promise.all([
			api.organizations.list({}),
			identityClient.passkey.listUserPasskeys(),
			identityClient.listSessions(),
		]);
		setOrganizations(organizations);
		if (credentials.data) setKeys(credentials.data);
		if (activeSessions.data) setSessions(activeSessions.data);
	}, [pendingMfa]);
	useEffect(() => {
		if (session) void refresh().catch(() => setMessage(t("failed")));
	}, [session, refresh, t]);
	async function perform(action: () => Promise<unknown>, success = "saved") {
		setBusy(true);
		setMessage("");
		try {
			await action();
			setMessage(t(success));
		} catch {
			setMessage(t("failed"));
		} finally {
			setBusy(false);
		}
	}
	async function passkeySignIn() {
		const result = await identityClient.signIn.passkey();
		if (result.error) throw new Error("passkey");
		await refetch();
	}
	if (isPending) return <p role="status">{t("loading")}</p>;
	return (
		<main className="mx-auto max-w-4xl space-y-8 p-6 sm:p-12">
			<header className="flex items-center justify-between gap-4">
				<h1 className="text-3xl font-semibold">
					{session ? t("title") : t("welcome")}
				</h1>
				<a href={`/${locale === "en" ? "es" : "en"}/account`}>
					{locale === "en" ? "Español" : "English"}
				</a>
			</header>
			<p role="status" aria-live="polite">
				{message}
			</p>
			{!session ? (
				<section className="max-w-lg space-y-5 rounded-xl border border-border bg-card p-6">
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							const intent = (
								event.nativeEvent as SubmitEvent
							).submitter?.getAttribute("value");
							void perform(async () => {
								if (intent === "register")
									await identityRequest("register", {
										email: data.get("email"),
										name: String(data.get("name") ?? "").trim() || undefined,
										locale,
									});
								else if (intent === "recover")
									await identityRequest("request-recovery", {
										email: data.get("email"),
										locale,
									});
								else
									await identityRequest("sign-in/magic-link", {
										email: data.get("email"),
										callbackURL: `/${locale}/account`,
										locale,
									});
							}, "sent");
						}}
					>
						<label htmlFor="account-field-1" className="grid gap-2">
							{t("email")}
							<Input
								id="account-field-1"
								name="email"
								type="email"
								autoComplete="email"
								required
							/>
						</label>
						<label htmlFor="account-field-2" className="grid gap-2">
							{t("name")}
							<Input
								id="account-field-2"
								name="name"
								autoComplete="name"
								maxLength={80}
							/>
						</label>
						<div className="flex flex-wrap gap-3">
							<Button disabled={busy} type="submit" value="login">
								{t("signIn")}
							</Button>
							<Button disabled={busy} type="submit" value="register">
								{t("register")}
							</Button>
							<Button disabled={busy} type="submit" value="recover">
								{t("recover")}
							</Button>
						</div>
					</form>
					<Button disabled={busy} onClick={() => void perform(passkeySignIn)}>
						{t("passkey")}
					</Button>
					<p className="text-sm text-muted-foreground">{t("recoveryHelp")}</p>
				</section>
			) : (
				<>
					<div className="flex items-center justify-between gap-4">
						<p>{session.user.email}</p>
						<Button
							disabled={busy}
							onClick={() =>
								void perform(async () => {
									const result = await identityClient.signOut();
									if (result.error) throw new Error("signout");
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
					{pendingMfa ? (
						<p
							role="alert"
							className="rounded-xl border border-border bg-card p-6"
						>
							{t("mfaRequired")}
						</p>
					) : (
						<section className="space-y-4 rounded-xl border border-border bg-card p-6">
							<h2 className="text-xl font-semibold">{t("organizations")}</h2>
							{organizations.length === 0 && <p>{t("noOrganizations")}</p>}
							<ul className="space-y-3">
								{organizations.map((organization) => (
									<li key={organization.id}>
										<a
											className="underline"
											href={`/${locale}/organizations/${organization.id}`}
										>
											{organization.name}
										</a>
									</li>
								))}
							</ul>
							<form
								className="grid gap-3 sm:grid-cols-3"
								onSubmit={(event) => {
									event.preventDefault();
									const data = new FormData(event.currentTarget);
									void perform(async () => {
										const created = await createApiClient(
											`${window.location.origin}/api/rpc`,
										).organizations.create({
											name: String(data.get("name")),
											slug: String(data.get("slug")),
											operationKey: crypto.randomUUID(),
										});
										window.location.assign(
											`/${locale}/organizations/${created.id}`,
										);
									});
								}}
							>
								<label htmlFor="account-field-3" className="grid gap-2">
									{t("organizationName")}
									<Input
										id="account-field-3"
										name="name"
										required
										maxLength={80}
									/>
								</label>
								<label htmlFor="account-field-4" className="grid gap-2">
									{t("slug")}
									<Input
										id="account-field-4"
										name="slug"
										required
										pattern="[a-z0-9][a-z0-9-]{1,62}"
									/>
								</label>
								<Button className="self-end" disabled={busy} type="submit">
									{t("create")}
								</Button>
							</form>
						</section>
					)}
					<section className="space-y-5 rounded-xl border border-border bg-card p-6">
						<h2 className="text-xl font-semibold">{t("security")}</h2>
						<p>{t("reauthenticate")}</p>
						<div className="flex flex-wrap gap-3">
							<Button
								disabled={busy}
								onClick={() => void perform(passkeySignIn)}
							>
								{t("passkey")}
							</Button>
							<Button
								disabled={busy}
								onClick={() =>
									void perform(
										() =>
											identityRequest("sign-in/magic-link", {
												email: session.user.email,
												locale,
											}),
										"sent",
									)
								}
							>
								{t("signIn")}
							</Button>
						</div>
						{!pendingMfa && (
							<>
								<form
									className="flex flex-wrap items-end gap-3"
									onSubmit={(event) => {
										event.preventDefault();
										const data = new FormData(event.currentTarget);
										void perform(async () => {
											const result = await identityClient.passkey.addPasskey({
												name: String(data.get("name")),
											});
											if (result.error) throw new Error("passkey");
											await refresh();
										});
									}}
								>
									<label htmlFor="account-field-5" className="grid gap-2">
										{t("passkeyName")}
										<Input
											id="account-field-5"
											name="name"
											required
											maxLength={80}
										/>
									</label>
									<Button disabled={busy} type="submit">
										{t("addPasskey")}
									</Button>
								</form>
								<ul className="space-y-2">
									{keys.map((key) => (
										<li className="flex items-center gap-4" key={key.id}>
											<span>{key.name ?? t("unnamedPasskey")}</span>
											<Button
												disabled={busy}
												onClick={() =>
													void perform(async () => {
														await identityRequest("revoke-passkey", {
															id: key.id,
														});
														await refresh();
													})
												}
											>
												{t("remove")}
											</Button>
										</li>
									))}
								</ul>
							</>
						)}
						<h3 className="font-semibold">{t("mfa")}</h3>
						{!pendingMfa && (
							<div className="flex flex-wrap gap-3">
								{!session.user.twoFactorEnabled ? (
									<Button
										disabled={busy}
										onClick={() =>
											void perform(async () =>
												setMfaSetup(
													await identityRequest("two-factor/enable", {}),
												),
											)
										}
									>
										{t("enableMfa")}
									</Button>
								) : (
									<>
										<Button
											disabled={busy}
											onClick={() =>
												void perform(async () => {
													const result = await identityRequest(
														"two-factor/generate-backup-codes",
														{},
													);
													setMfaSetup({ backupCodes: result.backupCodes });
												})
											}
										>
											{t("newRecoveryCodes")}
										</Button>
										<Button
											disabled={busy}
											onClick={() =>
												void perform(async () => {
													await identityRequest("two-factor/disable", {});
													setMfaSetup(null);
													await refetch();
												})
											}
										>
											{t("disableMfa")}
										</Button>
									</>
								)}
							</div>
						)}
						{mfaSetup && (
							<div className="space-y-3">
								<p>{t("mfaSetup")}</p>
								{mfaSetup.totpURI && (
									<code className="block break-all">{mfaSetup.totpURI}</code>
								)}
								<pre className="whitespace-pre-wrap">
									{mfaSetup.backupCodes.join("\n")}
								</pre>
							</div>
						)}
						{(session.user.twoFactorEnabled || mfaSetup?.totpURI) && (
							<form
								className="flex flex-wrap items-end gap-3"
								onSubmit={(event) => {
									event.preventDefault();
									const data = new FormData(event.currentTarget);
									void perform(async () => {
										await identityRequest("two-factor/verify-totp", {
											code: data.get("code"),
										});
										setMfaSetup(null);
										await refetch();
									});
								}}
							>
								<label htmlFor="account-field-6" className="grid gap-2">
									{t("code")}
									<Input
										id="account-field-6"
										name="code"
										inputMode="numeric"
										autoComplete="one-time-code"
										pattern="[0-9]{6}"
										required
									/>
								</label>
								<Button disabled={busy} type="submit">
									{t("verify")}
								</Button>
							</form>
						)}
						{session.user.twoFactorEnabled && (
							<details className="space-y-3">
								<summary className="cursor-pointer">
									{t("useRecoveryCode")}
								</summary>
								<p>{t("recoveryHelp")}</p>
								<form
									className="flex flex-wrap items-end gap-3"
									onSubmit={(event) => {
										event.preventDefault();
										const form = event.currentTarget;
										const data = new FormData(form);
										void perform(async () => {
											await identityRequest("two-factor/verify-backup-code", {
												code: data.get("code"),
											});
											form.reset();
											await refetch();
										});
									}}
								>
									<label htmlFor="account-field-7" className="grid gap-2">
										{t("recoveryCode")}
										<Input
											id="account-field-7"
											name="code"
											autoComplete="off"
											required
										/>
									</label>
									<Button disabled={busy} type="submit">
										{t("verify")}
									</Button>
								</form>
							</details>
						)}
					</section>
					{!pendingMfa && (
						<section className="space-y-4 rounded-xl border border-border bg-card p-6">
							<h2 className="text-xl font-semibold">{t("sessions")}</h2>
							<ul className="space-y-3">
								{sessions.map((active) => (
									<li
										className="flex flex-wrap items-center justify-between gap-3"
										key={active.id}
									>
										<span>
											{active.id === session.session.id
												? t("currentSession")
												: t("otherSession")}{" "}
											· {new Date(active.createdAt).toLocaleString(locale)}
										</span>
										{active.id !== session.session.id && (
											<Button
												disabled={busy}
												onClick={() =>
													void perform(async () => {
														const result = await identityClient.revokeSession({
															token: active.token,
														});
														if (result.error) throw new Error("session");
														await refresh();
													})
												}
											>
												{t("revokeSession")}
											</Button>
										)}
									</li>
								))}
							</ul>
							<Button
								disabled={busy}
								onClick={() =>
									void perform(async () => {
										const result = await identityClient.revokeOtherSessions();
										if (result.error) throw new Error("sessions");
										await refresh();
									})
								}
							>
								{t("revokeOthers")}
							</Button>
						</section>
					)}
				</>
			)}
		</main>
	);
}
