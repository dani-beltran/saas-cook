"use client";
import { Button } from "@saas-cook/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DashboardShell } from "../../components/dashboard-shell";
import { api, download, Status, useOperation } from "./common";

type Client = ReturnType<typeof api>["completion"];
export function PrivacyPage({ organizationId }: { organizationId?: string }) {
	const op = useOperation();
	const { locale } = op;
	const t = useTranslations("Phase6.Privacy");
	const [obligations, setObligations] =
			useState<Awaited<ReturnType<Client["deletionPreview"]>>>(),
		[request, setRequest] =
			useState<Awaited<ReturnType<Client["deletionRequest"]>>>(),
		[consent, setConsent] = useState(false),
		[preferences, setPreferences] =
			useState<Awaited<ReturnType<Client["notificationPreferences"]>>>(),
		[analytics, setAnalytics] =
			useState<Awaited<ReturnType<Client["analyticsGet"]>>>();
	useEffect(() => {
		let active = true;
		if (!organizationId)
			void Promise.all([
				api().completion.notificationPreferences({}),
				api().completion.analyticsGet({ organizationId: null }),
			])
				.then(([p, a]) => {
					if (active) {
						setPreferences(p);
						setAnalytics(a);
					}
				})
				.catch(() => {});
		return () => {
			active = false;
		};
	}, [organizationId]);

	return (
		<DashboardShell section="privacy" organizationId={organizationId}>
			<header className="dashboard-page-header">
				<h1>{t("title")}</h1>
			</header>
			<Status {...op} />
			{!organizationId && (
				<section className="completion-card">
					<Button
						disabled={op.busy}
						onClick={() =>
							void op.run(async () =>
								download(await api().completion.personalExport({})),
							)
						}
					>
						{t("personalExport")}
					</Button>
					<h2>{t("notificationsTitle")}</h2>
					{preferences && (
						<>
							<label className="completion-check">
								<input
									type="checkbox"
									checked={preferences.email}
									disabled={op.busy || preferences.suppressed}
									onChange={(e) =>
										void op.run(async () => {
											await api().completion.notificationSave({
												email: e.target.checked,
												inApp: preferences.inApp,
												locale,
												version: preferences.version,
											});
											setPreferences(
												await api().completion.notificationPreferences({}),
											);
										})
									}
								/>
								{t("email")}
							</label>
							<label className="completion-check">
								<input
									type="checkbox"
									checked={preferences.inApp}
									disabled={op.busy}
									onChange={(e) =>
										void op.run(async () => {
											await api().completion.notificationSave({
												email: preferences.email,
												inApp: e.target.checked,
												locale,
												version: preferences.version,
											});
											setPreferences(
												await api().completion.notificationPreferences({}),
											);
										})
									}
								/>
								{t("inApp")}
							</label>
							{preferences.suppressed && <p>{t("suppressed")}</p>}
						</>
					)}
					<p>{t("mandatoryNotice")}</p>
					{analytics && (
						<label className="completion-check">
							<input
								type="checkbox"
								disabled={op.busy}
								checked={analytics.enabled}
								onChange={(e) =>
									void op.run(async () =>
										setAnalytics(
											await api().completion.analyticsSet({
												organizationId: null,
												enabled: e.target.checked,
												version: analytics.version,
											}),
										),
									)
								}
							/>
							{t("analytics")}
						</label>
					)}
				</section>
			)}
			<section className="completion-card">
				<h2>{organizationId ? t("deleteOrganization") : t("deleteAccount")}</h2>
				<p>
					{organizationId
						? t("deleteOrganizationDescription")
						: t("deleteAccountDescription")}
				</p>
				<p>{t("retentionNotice")}</p>
				<p>
					<a href="/auth/confirm">{t("confirmIdentity")}</a>
				</p>
				{organizationId && (
					<a href={`../${organizationId}/data`}>{t("export")}</a>
				)}
				{!organizationId && (
					<Button
						disabled={op.busy}
						variant="secondary"
						onClick={() =>
							void op.run(async () =>
								setObligations(await api().completion.deletionPreview({})),
							)
						}
					>
						{t("checkOwnership")}
					</Button>
				)}
				{obligations && (
					<ul>
						{obligations.map((o) => (
							<li key={o.organizationId}>
								<a href={`/${locale}/organizations/${o.organizationId}`}>
									{o.name}
								</a>{" "}
								— {o.requiresSuccessor ? t("needsSuccessor") : t("noBlocker")}
							</li>
						))}
					</ul>
				)}
				{!request ? (
					<Button
						disabled={
							op.busy ||
							(!organizationId &&
								(!obligations || obligations.some((o) => o.requiresSuccessor)))
						}
						onClick={() =>
							void op.run(async () =>
								setRequest(
									await api().completion.deletionRequest({
										kind: organizationId ? "organization" : "account",
										organizationId,
										operationKey: crypto.randomUUID(),
									}),
								),
							)
						}
					>
						{t("prepareDeletion")}
					</Button>
				) : (
					<>
						<p>{t("saveReceipt")}</p>
						<a href={`/${locale}/deletion#${request.id}.${request.receipt}`}>
							{t("deletionStatus")}
						</a>
						<label className="completion-check">
							<input
								type="checkbox"
								checked={consent}
								onChange={(e) => setConsent(e.target.checked)}
							/>
							{t("deletionConsent")}
						</label>
						<div className="completion-actions">
							<Button
								disabled={op.busy || !consent}
								onClick={() =>
									void op.run(async () => {
										await api().completion.deletionConfirm({ id: request.id });
										window.location.assign(
											`/${locale}/deletion#${request.id}.${request.receipt}`,
										);
									})
								}
							>
								{t("confirmDeletion")}
							</Button>
							<Button
								variant="secondary"
								disabled={op.busy}
								onClick={() =>
									void op.run(async () => {
										await api().completion.deletionCancel({ id: request.id });
										setRequest(undefined);
										setConsent(false);
									})
								}
							>
								{t("cancelDeletion")}
							</Button>
						</div>
					</>
				)}
			</section>
		</DashboardShell>
	);
}
export function ReceiptPage({
	unsubscribe = false,
}: {
	unsubscribe?: boolean;
}) {
	const op = useOperation();
	const t = useTranslations("Phase6.Privacy");
	const [state, setState] =
		useState<Awaited<ReturnType<Client["deletionStatus"]>>>();
	return (
		<main className="completion-public">
			<h1>{unsubscribe ? t("unsubscribeTitle") : t("deletionStatus")}</h1>
			<Status {...op} />
			<Button
				disabled={op.busy}
				onClick={() =>
					void op.run(async () => {
						const receipt = window.location.hash.slice(1);
						if (unsubscribe) {
							await api().completion.unsubscribe({ receipt });
						} else {
							const split = receipt.indexOf(".");
							setState(
								await api().completion.deletionStatus({
									id: receipt.slice(0, split),
									receipt: receipt.slice(split + 1),
								}),
							);
						}
					})
				}
			>
				{unsubscribe ? t("confirmUnsubscribe") : t("checkStatus")}
			</Button>
			{state && (
				<section className="completion-card">
					<p>{state.state}</p>
					<p>{t("completedSteps", { steps: state.steps.join(", ") || "—" })}</p>
					<p>{t("retained", { categories: state.retained.join(", ") })}</p>
					<p>{t("backupNotice")}</p>
				</section>
			)}
		</main>
	);
}
