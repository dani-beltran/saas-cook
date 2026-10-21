"use client";
import { Button } from "@saas-cook/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DashboardShell } from "../../components/dashboard-shell";
import { Status, useOperation } from "../../components/feature-ui";
import { api } from "../../lib/api-client";
import { download } from "../../lib/download";
import { NotificationPreferences } from "../notifications/preferences";

type Client = ReturnType<typeof api>["privacy"];
/**
 * Displays own-account privacy or an organization's export/deletion workflow.
 * @param props - Optional organizationId selects organization scope; omission selects the current account.
 * @returns A dashboard with explicit deletion preparation/confirmation and status feedback.
 * Services recheck fresh authentication, ownership and permissions before any destructive effect.
 */
export function PrivacyPage({ organizationId }: { organizationId?: string }) {
	const op = useOperation();
	const { locale } = op;
	const t = useTranslations("Privacy");
	const [obligations, setObligations] =
			useState<Awaited<ReturnType<Client["previewDeletion"]>>>(),
		[request, setRequest] =
			useState<Awaited<ReturnType<Client["requestDeletion"]>>>(),
		[consent, setConsent] = useState(false),
		[analytics, setAnalytics] =
			useState<
				Awaited<ReturnType<ReturnType<typeof api>["analytics"]["preferences"]>>
			>();
	useEffect(() => {
		let active = true;
		if (!organizationId)
			void api()
				.analytics.preferences({ organizationId: null })
				.then((a) => {
					if (active) setAnalytics(a);
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
				<section className="feature-card">
					<Button
						disabled={op.busy}
						onClick={() =>
							void op.run(async () =>
								download(await api().privacy.exportAccount({})),
							)
						}
					>
						{t("personalExport")}
					</Button>
					<NotificationPreferences />
					{analytics && (
						<label className="feature-check">
							<input
								type="checkbox"
								disabled={op.busy}
								checked={analytics.enabled}
								onChange={(e) =>
									void op.run(async () =>
										setAnalytics(
											await api().analytics.setPreference({
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
			<section className="feature-card">
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
								setObligations(await api().privacy.previewDeletion({})),
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
									await api().privacy.requestDeletion({
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
						<label className="feature-check">
							<input
								type="checkbox"
								checked={consent}
								onChange={(e) => setConsent(e.target.checked)}
							/>
							{t("deletionConsent")}
						</label>
						<div className="feature-actions">
							<Button
								disabled={op.busy || !consent}
								onClick={() =>
									void op.run(async () => {
										await api().privacy.confirmDeletion({ id: request.id });
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
										await api().privacy.cancelDeletion({ id: request.id });
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
