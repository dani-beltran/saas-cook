"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { createApiClient } from "@saas-cook/api/client";
import {
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	Input,
} from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DashboardShell } from "../../components/dashboard-shell";
import "./platform.css";

const api = () => createApiClient(`${window.location.origin}/api/rpc`);
type Accounts = Awaited<
	ReturnType<ReturnType<typeof api>["platform"]["accounts"]>
>;
type Keys = Awaited<ReturnType<ReturnType<typeof api>["platform"]["keys"]>>;
type Scope =
	| "project:read"
	| "project:create"
	| "project:update"
	| "project:delete"
	| "project:restore"
	| "project:manage";
const form = z.object({ name: z.string().trim().min(1).max(120) });
export function KeyAdministration({
	organizationId,
}: {
	organizationId: string;
}) {
	const locale = useLocale();
	const t = useTranslations("Phase6.Keys");
	const [accounts, setAccounts] = useState<Accounts>(),
		[cursor, setCursor] = useState<string>(),
		[selected, setSelected] = useState<Accounts["items"][number]>(),
		[revision, setRevision] = useState(0),
		[failed, setFailed] = useState(false),
		[busy, setBusy] = useState(false);
	const [caps, setCaps] = useState<Array<"project:read" | "project:create">>(
		[],
	);
	const operation = useRef<{ signature: string; key: string } | undefined>(
		undefined,
	);
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<z.infer<typeof form>>({
		resolver: zodResolver(form),
		defaultValues: { name: "" },
	});
	useEffect(() => {
		void revision;
		let alive = true;
		setAccounts(undefined);
		setFailed(false);
		api()
			.platform.accounts({ organizationId, cursor, limit: 25 })
			.then((p) => {
				if (alive) setAccounts(p);
			})
			.catch(() => {
				if (alive) setFailed(true);
			});
		return () => {
			alive = false;
		};
	}, [organizationId, cursor, revision]);
	return (
		<DashboardShell section="keys" organizationId={organizationId}>
			<header className="dashboard-page-header">
				<div>
					<h1>{t("title")}</h1>
					<p>{t("hint")}</p>
					<a href={`/${locale}/account#security`}>{t("verify")}</a>
				</div>
			</header>
			{failed && (
				<p role="alert">
					{t("failed")}{" "}
					<Button onClick={() => setRevision((v) => v + 1)}>
						{t("retry")}
					</Button>
				</p>
			)}
			<form
				className="platform-key-form"
				onSubmit={handleSubmit(async (value) => {
					if (busy) return;
					setBusy(true);
					setFailed(false);
					const signature = JSON.stringify([value, caps]);
					if (operation.current?.signature !== signature)
						operation.current = { signature, key: crypto.randomUUID() };
					try {
						const account = await api().serviceAccounts.create({
							organizationId,
							...value,
							capabilities: caps,
							operationKey: operation.current.key,
						});
						operation.current = undefined;
						reset();
						setSelected(account);
						setCursor(undefined);
						setRevision((v) => v + 1);
					} catch {
						setFailed(true);
					} finally {
						setBusy(false);
					}
				})}
			>
				<label htmlFor="key-account-name">{t("name")}</label>
				<Input
					id="key-account-name"
					{...register("name")}
					required
					maxLength={120}
					aria-invalid={Boolean(errors.name)}
					disabled={busy}
				/>
				{(["project:read", "project:create"] as const).map((cap) => (
					<label key={cap} htmlFor={`key-cap-${cap}`}>
						<Checkbox
							id={`key-cap-${cap}`}
							checked={caps.includes(cap)}
							onCheckedChange={(checked) =>
								setCaps((v) =>
									checked ? [...v, cap] : v.filter((s) => s !== cap),
								)
							}
							disabled={busy}
						/>
						{cap === "project:read" ? t("readAll") : t("createAll")}
					</label>
				))}
				<Button disabled={busy} type="submit">
					{t("create")}
				</Button>
			</form>
			{!accounts && !failed ? (
				<p role="status">{t("loading")}</p>
			) : (
				accounts && (
					<>
						<ul className="platform-results">
							{accounts.items.map((a) => (
								<li key={a.id}>
									<strong>{a.name}</strong>
									<span>{t(a.status)}</span>
									<Button onClick={() => setSelected(a)}>{t("title")}</Button>
								</li>
							))}
						</ul>
						{!accounts.items.length && <p>{t("empty")}</p>}
						{accounts.nextCursor && (
							<Button
								onClick={() => {
									setSelected(undefined);
									setCursor(accounts.nextCursor ?? undefined);
								}}
							>
								{t("next")}
							</Button>
						)}
					</>
				)
			)}
			{selected && (
				<AccountKeys
					key={`${organizationId}:${selected.id}:${selected.version}`}
					organizationId={organizationId}
					account={selected}
					changed={(account) => {
						setSelected(account);
						setRevision((v) => v + 1);
					}}
				/>
			)}
		</DashboardShell>
	);
}
function AccountKeys({
	organizationId,
	account,
	changed,
}: {
	organizationId: string;
	account: Accounts["items"][number];
	changed: (account: Accounts["items"][number]) => void;
}) {
	const locale = useLocale();
	const t = useTranslations("Phase6.Keys");
	const [keys, setKeys] = useState<Keys>(),
		[cursor, setCursor] = useState<string>(),
		[revision, setRevision] = useState(0),
		[failure, setFailure] = useState<string>(),
		[busy, setBusy] = useState(false),
		[secret, setSecret] = useState<string>();
	const [scopes, setScopes] = useState<Scope[]>(["project:read"]),
		[expires, setExpires] = useState(() => {
			const d = new Date(Date.now() + 30 * 86400000);
			d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
			return d.toISOString().slice(0, 16);
		});
	const [confirm, setConfirm] = useState<{
		message: string;
		run: () => Promise<unknown>;
	}>();
	const pending = useRef<{ signature: string; key: string } | undefined>(
		undefined,
	);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	useEffect(() => {
		void revision;
		let current = true;
		setKeys(undefined);
		api()
			.platform.keys({
				organizationId,
				serviceAccountId: account.id,
				cursor,
				limit: 25,
			})
			.then((p) => {
				if (current) setKeys(p);
			})
			.catch(() => {
				if (current) setFailure(t("failed"));
			});
		return () => {
			current = false;
		};
	}, [organizationId, account.id, cursor, revision, t]);
	function operationKey(signature: string) {
		if (pending.current?.signature !== signature)
			pending.current = { signature, key: crypto.randomUUID() };
		return pending.current.key;
	}
	async function run(work: () => Promise<unknown>, issuing = false) {
		if (busy) return;
		setBusy(true);
		setFailure(undefined);
		try {
			await work();
			pending.current = undefined;
			if (alive.current) {
				setConfirm(undefined);
				setRevision((v) => v + 1);
			}
		} catch {
			if (alive.current) setFailure(issuing ? t("unavailable") : t("failed"));
		} finally {
			if (alive.current) setBusy(false);
		}
	}
	async function issue(keyId?: string) {
		const expiresAt = new Date(expires).toISOString();
		const signature = JSON.stringify([keyId, account.id, scopes, expiresAt]);
		const response = keyId
			? await api().serviceAccounts.rotate({
					organizationId,
					keyId,
					expiresAt,
					operationKey: operationKey(signature),
				})
			: await api().serviceAccounts.issue({
					organizationId,
					serviceAccountId: account.id,
					scopes,
					expiresAt,
					operationKey: operationKey(signature),
				});
		if (alive.current) setSecret(response.secret);
	}
	const scopeLabels = {
		"project:read": t("read"),
		"project:create": t("createScope"),
		"project:update": t("update"),
		"project:delete": t("delete"),
		"project:restore": t("restore"),
		"project:manage": t("manage"),
	};
	return (
		<section className="platform-activity">
			<h2>{account.name}</h2>
			{failure && (
				<p role="alert">
					{failure}{" "}
					<Button
						onClick={() => {
							setFailure(undefined);
							setRevision((v) => v + 1);
						}}
					>
						{t("retry")}
					</Button>
				</p>
			)}
			<Button
				disabled={busy || Boolean(secret)}
				onClick={() =>
					setConfirm({
						message:
							account.status === "active"
								? t("confirmDeactivate")
								: t("activate"),
						run: async () =>
							changed(
								await api().serviceAccounts.setStatus({
									organizationId,
									id: account.id,
									version: account.version,
									status: account.status === "active" ? "inactive" : "active",
								}),
							),
					})
				}
			>
				{account.status === "active" ? t("deactivate") : t("activate")}
			</Button>
			{secret ? (
				<section role="status">
					<p>{t("secret")}</p>
					<Input
						aria-label={t("secret")}
						value={secret}
						readOnly
						autoComplete="off"
					/>
					<Button onClick={() => setSecret(undefined)}>{t("dismiss")}</Button>
				</section>
			) : (
				<form
					className="platform-key-form"
					onSubmit={(event) => {
						event.preventDefault();
						void run(() => issue(), true);
					}}
				>
					<fieldset disabled={busy || account.status !== "active"}>
						<legend>{t("scopes")}</legend>
						{(Object.keys(scopeLabels) as Scope[]).map((scope) => (
							<label key={scope} htmlFor={`key-scope-${account.id}-${scope}`}>
								<Checkbox
									id={`key-scope-${account.id}-${scope}`}
									checked={scopes.includes(scope)}
									onCheckedChange={(checked) =>
										setScopes((v) =>
											checked ? [...v, scope] : v.filter((s) => s !== scope),
										)
									}
								/>
								{scopeLabels[scope]}
							</label>
						))}
						<label htmlFor={`key-expiry-${account.id}`}>{t("expires")}</label>
						<Input
							id={`key-expiry-${account.id}`}
							type="datetime-local"
							required
							value={expires}
							onChange={(event) => setExpires(event.target.value)}
						/>
						<Button type="submit" disabled={!scopes.length}>
							{t("issue")}
						</Button>
					</fieldset>
				</form>
			)}
			{!keys && !failure ? (
				<p role="status">{t("loading")}</p>
			) : (
				keys && (
					<>
						<ul className="platform-results">
							{keys.items.map((key) => (
								<li key={key.id}>
									<strong>{key.prefix}</strong>
									<span>
										{key.revokedAt
											? t("revoked")
											: Date.parse(key.expiresAt) <= Date.now()
												? t("expired")
												: t("active")}
									</span>
									<time dateTime={key.expiresAt}>
										{new Date(key.expiresAt).toLocaleString(locale)}
									</time>
									<span>{key.scopes.join(", ")}</span>
									{!key.revokedAt && (
										<>
											<Button
												disabled={busy || Boolean(secret)}
												onClick={() =>
													setConfirm({
														message: t("confirmRotate"),
														run: () => issue(key.id),
													})
												}
											>
												{t("rotate")}
											</Button>
											<Button
												disabled={busy || Boolean(secret)}
												onClick={() =>
													setConfirm({
														message: t("confirmRevoke"),
														run: () =>
															api().serviceAccounts.revoke({
																organizationId,
																keyId: key.id,
															}),
													})
												}
											>
												{t("revoke")}
											</Button>
										</>
									)}
								</li>
							))}
						</ul>
						{!keys.items.length && <p>{t("noKeys")}</p>}
						{keys.nextCursor && (
							<Button
								disabled={busy || Boolean(secret)}
								onClick={() => setCursor(keys.nextCursor ?? undefined)}
							>
								{t("next")}
							</Button>
						)}
					</>
				)
			)}
			<Dialog
				open={Boolean(confirm)}
				onOpenChange={(open) => {
					if (!open && !busy) setConfirm(undefined);
				}}
			>
				<DialogContent>
					<DialogTitle>{t("confirm")}</DialogTitle>
					<DialogDescription>{confirm?.message}</DialogDescription>
					{failure && <p role="alert">{failure}</p>}
					<Button disabled={busy} onClick={() => setConfirm(undefined)}>
						{t("cancel")}
					</Button>
					<Button
						disabled={busy}
						onClick={() => {
							if (confirm)
								void run(confirm.run, confirm.message === t("confirmRotate"));
						}}
					>
						{t("confirm")}
					</Button>
				</DialogContent>
			</Dialog>
		</section>
	);
}
