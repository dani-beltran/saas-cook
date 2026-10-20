"use client";
import { Button, Input, NativeSelect, NativeSelectOption } from "@saas-cook/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DashboardShell } from "../../components/dashboard-shell";
import { api, Reload, Status, useOperation } from "./common";

type Client = ReturnType<typeof api>["completion"];
type Endpoint = Awaited<ReturnType<Client["webhooks"]>>;
type Connections = Awaited<ReturnType<Client["integrations"]>>;
type Grants = Awaited<ReturnType<Client["auditGrants"]>>;
type Audit = Awaited<ReturnType<Client["audit"]>>;
export function OrganizationSettings({
	organizationId,
}: {
	organizationId: string;
}) {
	const op = useOperation();
	const { locale } = op;
	const t = useTranslations("Phase6.Settings");
	const [webhooks, setWebhooks] = useState<Endpoint>(),
		[integrations, setIntegrations] = useState<Connections>(),
		[grants, setGrants] = useState<Grants>(),
		[secret, setSecret] = useState<string | null>(),
		[audit, setAudit] = useState<Audit>(),
		[deliveries, setDeliveries] =
			useState<Awaited<ReturnType<Client["webhookDeliveries"]>>>(),
		[preference, setPreference] =
			useState<Awaited<ReturnType<Client["analyticsGet"]>>>();
	const load = async () => {
		const c = api().completion;
		const results = await Promise.all([
			c.webhooks({ organizationId }),
			c.integrations({ organizationId }),
			c.auditGrants({ organizationId }),
			c.analyticsGet({ organizationId }),
		]);
		setWebhooks(results[0]);
		setIntegrations(results[1]);
		setGrants(results[2]);
		setPreference(results[3]);
	};
	useEffect(() => {
		let active = true;
		const c = api().completion;
		void Promise.all([
			c.webhooks({ organizationId }),
			c.integrations({ organizationId }),
			c.auditGrants({ organizationId }),
			c.analyticsGet({ organizationId }),
		])
			.then(([w, i, g, p]) => {
				if (active) {
					setWebhooks(w);
					setIntegrations(i);
					setGrants(g);
					setPreference(p);
				}
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [organizationId]);

	return (
		<DashboardShell section="settings" organizationId={organizationId}>
			<header className="dashboard-page-header">
				<h1>{t("title")}</h1>
				<Reload load={() => void op.run(load)} disabled={op.busy} />
			</header>
			<p>
				{t("freshAuthNotice")}{" "}
				<a href={`/${locale}/account#reauthenticate`}>{t("confirmIdentity")}</a>
			</p>
			<Status {...op} />
			{secret && (
				<section className="completion-card" aria-label={t("secretTitle")}>
					<p>{t("saveSecret")}</p>
					<code className="completion-secret">{secret}</code>
					<Button onClick={() => setSecret(null)}>{t("dismiss")}</Button>
				</section>
			)}
			<section className="completion-card">
				<h2>{t("analyticsTitle")}</h2>
				{preference ? (
					<>
						<p>
							{preference.configured
								? t("configured")
								: t("collectionDisabled")}
						</p>
						<label className="completion-check">
							<input
								type="checkbox"
								checked={preference.enabled}
								disabled={op.busy}
								onChange={(e) =>
									void op.run(async () =>
										setPreference(
											await api().completion.analyticsSet({
												organizationId,
												enabled: e.target.checked,
												version: preference.version,
											}),
										),
									)
								}
							/>
							{t("analyticsConsent")}
						</label>
					</>
				) : (
					<p>{t("unavailable")}</p>
				)}
			</section>
			<section className="completion-card">
				<h2>{t("webhooksTitle")}</h2>
				<p>{t("webhooksHint")}</p>
				<form
					className="completion-form"
					onSubmit={(e) => {
						e.preventDefault();
						const form = e.currentTarget,
							f = new FormData(form);
						void op.run(async () => {
							const r = await api().completion.webhookCreate({
								organizationId,
								name: String(f.get("name")),
								url: String(f.get("url")),
								events: [
									f.get("event") as
										| "project.created"
										| "project.updated"
										| "project.deleted"
										| "bulk.completed",
								],
								operationKey: crypto.randomUUID(),
							});
							setSecret(r.secret);
							form.reset();
							await load();
						});
					}}
				>
					<label htmlFor="settings-field-1">
						{t("name")}
						<Input id="settings-field-1" name="name" required maxLength={80} />
					</label>
					<label htmlFor="settings-field-2">
						{t("url")}
						<Input
							id="settings-field-2"
							name="url"
							type="url"
							required
							maxLength={500}
							placeholder="https://"
						/>
					</label>
					<label htmlFor="settings-field-3">
						{t("event")}
						<NativeSelect id="settings-field-3" name="event">
							{[
								"project.created",
								"project.updated",
								"project.deleted",
								"bulk.completed",
							].map((v) => (
								<NativeSelectOption key={v} value={v}>
									{v}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</label>
					<Button type="submit" disabled={op.busy}>
						{t("createWebhook")}
					</Button>
				</form>
				<ul className="completion-list">
					{webhooks?.map((w) => (
						<li key={w.id}>
							<strong>{w.name}</strong>
							<p>
								{w.url} · {w.state}
							</p>
							<div className="completion-actions">
								{w.state !== "revoked" &&
									(["verify", "rotate", "revoke"] as const).map((action, i) => (
										<Button
											key={action}
											variant="secondary"
											disabled={op.busy}
											onClick={() =>
												void op.run(async () => {
													const r = await api().completion.webhookCommand({
														organizationId,
														id: w.id,
														version: w.version,
														action,
														operationKey: crypto.randomUUID(),
													});
													setSecret(r.secret);
													await load();
												})
											}
										>
											{[t("verify"), t("rotateSecret"), t("revoke")][i]}
										</Button>
									))}
								<Button
									variant="secondary"
									disabled={op.busy}
									onClick={() =>
										void op.run(async () =>
											setDeliveries(
												await api().completion.webhookDeliveries({
													organizationId,
													endpointId: w.id,
												}),
											),
										)
									}
								>
									{t("deliveries")}
								</Button>
							</div>
						</li>
					))}
				</ul>
				{webhooks?.length === 0 && <p>{t("noWebhooks")}</p>}
				{deliveries && (
					<ul className="completion-list">
						{deliveries.length === 0 ? (
							<li>{t("noDeliveries")}</li>
						) : (
							deliveries.map((d) => (
								<li key={d.id}>
									{d.event} · {d.state} · {t("attempts", { count: d.attempts })}
									{d.lastStatus ? ` · HTTP ${d.lastStatus}` : ""}
								</li>
							))
						)}
					</ul>
				)}
			</section>
			<section className="completion-card">
				<h2>{t("integrationsTitle")}</h2>
				<p>{t("integrationsHint")}</p>
				<form
					className="completion-form"
					onSubmit={(e) => {
						e.preventDefault();
						const form = e.currentTarget,
							f = new FormData(form);
						void op.run(async () => {
							await api().completion.integrationCreate({
								organizationId,
								name: String(f.get("name")),
								url: String(f.get("url")),
								token: String(f.get("token")),
								scopes: String(f.get("scopes"))
									.split(",")
									.map((v) => v.trim()),
								operationKey: crypto.randomUUID(),
							});
							form.reset();
							await load();
						});
					}}
				>
					<label htmlFor="settings-field-4">
						{t("name")}
						<Input id="settings-field-4" name="name" maxLength={80} required />
					</label>
					<label htmlFor="settings-field-5">
						{t("url")}
						<Input
							id="settings-field-5"
							name="url"
							type="url"
							maxLength={500}
							required
						/>
					</label>
					<label htmlFor="settings-field-6">
						{t("providerToken")}
						<Input
							id="settings-field-6"
							name="token"
							type="password"
							autoComplete="off"
							required
							minLength={16}
							maxLength={4096}
						/>
					</label>
					<label htmlFor="settings-field-7">
						{t("scopes")}
						<Input
							id="settings-field-7"
							name="scopes"
							required
							maxLength={1200}
						/>
					</label>
					<Button type="submit" disabled={op.busy}>
						{t("connect")}
					</Button>
				</form>
				<ul className="completion-list">
					{integrations?.map((c) => (
						<li key={c.id}>
							<strong>{c.name}</strong>
							<p>
								{c.state} · {c.scopes.join(", ")}
							</p>
							{c.state !== "revoked" && (
								<>
									<div className="completion-actions">
										{(["check", "revoke"] as const).map((action, i) => (
											<Button
												key={action}
												variant="secondary"
												disabled={op.busy}
												onClick={() =>
													void op.run(async () => {
														await api().completion.integrationCommand({
															organizationId,
															id: c.id,
															version: c.version,
															action,
															operationKey: crypto.randomUUID(),
														});
														await load();
													})
												}
											>
												{[t("checkHealth"), t("disconnect")][i]}
											</Button>
										))}
									</div>
									<form
										className="completion-form"
										onSubmit={(e) => {
											e.preventDefault();
											const form = e.currentTarget,
												token = String(new FormData(form).get("token"));
											void op.run(async () => {
												await api().completion.integrationCommand({
													organizationId,
													id: c.id,
													version: c.version,
													action: "rotate",
													token,
													operationKey: crypto.randomUUID(),
												});
												form.reset();
												await load();
											});
										}}
									>
										<label htmlFor={`integration-token-${c.id}`}>
											{t("replacementToken")}
											<Input
												id={`integration-token-${c.id}`}
												name="token"
												type="password"
												required
												minLength={16}
												maxLength={4096}
												autoComplete="off"
											/>
										</label>
										<Button type="submit" disabled={op.busy}>
											{t("rotateToken")}
										</Button>
									</form>
								</>
							)}
						</li>
					))}
				</ul>
				{integrations?.length === 0 && <p>{t("noIntegrations")}</p>}
			</section>
			<section className="completion-card">
				<h2>{t("auditTitle")}</h2>
				<p>{t("auditHint")}</p>
				<ul className="completion-list">
					{grants?.map((g) => (
						<li key={g.membershipId}>
							<span>
								{g.role} · {g.membershipId}
							</span>
							<Button
								disabled={op.busy}
								variant="secondary"
								onClick={() =>
									void op.run(async () => {
										await api().completion.auditGrant({
											organizationId,
											membershipId: g.membershipId,
											enabled: !g.enabled,
											version: g.version,
											operationKey: crypto.randomUUID(),
										});
										await load();
									})
								}
							>
								{g.enabled ? t("removeAccess") : t("grantAccess")}
							</Button>
						</li>
					))}
				</ul>
				<Button
					disabled={op.busy}
					onClick={() =>
						void op.run(async () =>
							setAudit(await api().completion.audit({ organizationId })),
						)
					}
				>
					{t("queryAudit")}
				</Button>
				{audit && (
					<>
						<div className="completion-scroll">
							<table className="completion-table">
								<caption>{t("securityEvents")}</caption>
								<thead>
									<tr>
										{[t("date"), t("action"), t("actor"), t("target")].map(
											(h) => (
												<th scope="col" key={h}>
													{h}
												</th>
											),
										)}
									</tr>
								</thead>
								<tbody>
									{audit.items.map((r) => (
										<tr key={r.id}>
											<td>{new Date(r.occurredAt).toLocaleString(locale)}</td>
											<td>{r.action}</td>
											<td>{r.actor}</td>
											<td>{r.targetId}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{audit.nextCursor && (
							<Button
								disabled={op.busy}
								onClick={() =>
									void op.run(async () =>
										setAudit(
											await api().completion.audit({
												organizationId,
												cursor: audit.nextCursor ?? undefined,
											}),
										),
									)
								}
							>
								{t("olderEvents")}
							</Button>
						)}
					</>
				)}
			</section>
			<a href={`../${organizationId}/privacy`}>{t("privacy")}</a>
		</DashboardShell>
	);
}
