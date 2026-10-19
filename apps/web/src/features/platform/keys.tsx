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
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DashboardShell } from "../../components/dashboard-shell";
import { keyMessages } from "./key-messages";
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
	const locale = useLocale(),
		copy = keyMessages[locale === "es" ? "es" : "en"];
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
					<h1>{copy.title}</h1>
					<p>{copy.hint}</p>
					<a href={`/${locale}/account#security`}>{copy.verify}</a>
				</div>
			</header>
			{failed && (
				<p role="alert">
					{copy.failed}{" "}
					<Button onClick={() => setRevision((v) => v + 1)}>
						{copy.retry}
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
				<label htmlFor="key-account-name">{copy.name}</label>
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
						{cap === "project:read" ? copy.readAll : copy.createAll}
					</label>
				))}
				<Button disabled={busy} type="submit">
					{copy.create}
				</Button>
			</form>
			{!accounts && !failed ? (
				<p role="status">{copy.loading}</p>
			) : (
				accounts && (
					<>
						<ul className="platform-results">
							{accounts.items.map((a) => (
								<li key={a.id}>
									<strong>{a.name}</strong>
									<span>{copy[a.status]}</span>
									<Button onClick={() => setSelected(a)}>{copy.title}</Button>
								</li>
							))}
						</ul>
						{!accounts.items.length && <p>{copy.empty}</p>}
						{accounts.nextCursor && (
							<Button
								onClick={() => {
									setSelected(undefined);
									setCursor(accounts.nextCursor ?? undefined);
								}}
							>
								{copy.next}
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
	const locale = useLocale(),
		copy = keyMessages[locale === "es" ? "es" : "en"];
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
				if (current) setFailure(copy.failed);
			});
		return () => {
			current = false;
		};
	}, [organizationId, account.id, cursor, revision, copy.failed]);
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
			if (alive.current) setFailure(issuing ? copy.unavailable : copy.failed);
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
		"project:read": copy.read,
		"project:create": copy.createScope,
		"project:update": copy.update,
		"project:delete": copy.delete,
		"project:restore": copy.restore,
		"project:manage": copy.manage,
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
						{copy.retry}
					</Button>
				</p>
			)}
			<Button
				disabled={busy || Boolean(secret)}
				onClick={() =>
					setConfirm({
						message:
							account.status === "active"
								? copy.confirmDeactivate
								: copy.activate,
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
				{account.status === "active" ? copy.deactivate : copy.activate}
			</Button>
			{secret ? (
				<section role="status">
					<p>{copy.secret}</p>
					<Input
						aria-label={copy.secret}
						value={secret}
						readOnly
						autoComplete="off"
					/>
					<Button onClick={() => setSecret(undefined)}>{copy.dismiss}</Button>
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
						<legend>{copy.scopes}</legend>
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
						<label htmlFor={`key-expiry-${account.id}`}>{copy.expires}</label>
						<Input
							id={`key-expiry-${account.id}`}
							type="datetime-local"
							required
							value={expires}
							onChange={(event) => setExpires(event.target.value)}
						/>
						<Button type="submit" disabled={!scopes.length}>
							{copy.issue}
						</Button>
					</fieldset>
				</form>
			)}
			{!keys && !failure ? (
				<p role="status">{copy.loading}</p>
			) : (
				keys && (
					<>
						<ul className="platform-results">
							{keys.items.map((key) => (
								<li key={key.id}>
									<strong>{key.prefix}</strong>
									<span>
										{key.revokedAt
											? copy.revoked
											: Date.parse(key.expiresAt) <= Date.now()
												? copy.expired
												: copy.active}
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
														message: copy.confirmRotate,
														run: () => issue(key.id),
													})
												}
											>
												{copy.rotate}
											</Button>
											<Button
												disabled={busy || Boolean(secret)}
												onClick={() =>
													setConfirm({
														message: copy.confirmRevoke,
														run: () =>
															api().serviceAccounts.revoke({
																organizationId,
																keyId: key.id,
															}),
													})
												}
											>
												{copy.revoke}
											</Button>
										</>
									)}
								</li>
							))}
						</ul>
						{!keys.items.length && <p>{copy.noKeys}</p>}
						{keys.nextCursor && (
							<Button
								disabled={busy || Boolean(secret)}
								onClick={() => setCursor(keys.nextCursor ?? undefined)}
							>
								{copy.next}
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
					<DialogTitle>{copy.confirm}</DialogTitle>
					<DialogDescription>{confirm?.message}</DialogDescription>
					{failure && <p role="alert">{failure}</p>}
					<Button disabled={busy} onClick={() => setConfirm(undefined)}>
						{copy.cancel}
					</Button>
					<Button
						disabled={busy}
						onClick={() => {
							if (confirm)
								void run(confirm.run, confirm.message === copy.confirmRotate);
						}}
					>
						{copy.confirm}
					</Button>
				</DialogContent>
			</Dialog>
		</section>
	);
}
