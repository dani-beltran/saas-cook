"use client";
import { Button, Checkbox } from "@saas-cook/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { DashboardShell } from "../../components/dashboard-shell";
import { Status, useOperation } from "../../components/feature-ui";
import { api } from "../../lib/api-client";
import { download } from "../../lib/download";
import { NotificationPreferences } from "../notifications/preferences";
import "./privacy.css";

type Client = ReturnType<typeof api>["privacy"];
/**
 * Displays own-account privacy or an organization's export/deletion workflow.
 * @param props - Optional organizationId selects organization scope; omission selects the current account.
 * @returns A dashboard with explicit deletion preparation/confirmation and status feedback.
 * Services recheck fresh authentication, ownership and permissions before any destructive effect.
 */
export function PrivacyPage({ organizationId }: { organizationId?: string }) {
	const op = useOperation();
	const [operationArea, setOperationArea] = useState<
		"data" | "analytics" | "deletion"
	>("deletion");
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
			>(),
		[analyticsState, setAnalyticsState] = useState<
			"loading" | "ready" | "error"
		>("loading"),
		[retry, setRetry] = useState(0);
	const confirmation = useRef<HTMLElement>(null);
	const prepareButton = useRef<HTMLButtonElement>(null);
	const previousRequest = useRef(request);
	const blocked = obligations?.some((o) => o.requiresSuccessor) ?? false;
	useEffect(() => {
		if (request) confirmation.current?.focus();
		else if (previousRequest.current) prepareButton.current?.focus();
		previousRequest.current = request;
	}, [request]);
	useEffect(() => {
		void retry;
		let active = true;
		if (!organizationId) {
			setAnalyticsState("loading");
			void api()
				.analytics.preferences({ organizationId: null })
				.then((a) => {
					if (active) {
						setAnalytics(a);
						setAnalyticsState("ready");
					}
				})
				.catch(() => {
					if (active) setAnalyticsState("error");
				});
		}
		return () => {
			active = false;
		};
	}, [organizationId, retry]);

	function run(area: typeof operationArea, work: () => Promise<unknown>) {
		if (op.busy) return;
		setOperationArea(area);
		return op.run(work);
	}
	function operationStatus(area: typeof operationArea) {
		return (
			<div className="privacy-feedback">
				<Status
					busy={op.busy && operationArea === area}
					message={operationArea === area ? op.message : ""}
				/>
			</div>
		);
	}

	return (
		<DashboardShell section="privacy" organizationId={organizationId}>
			<div className="privacy-page">
				<header className="privacy-header">
					<h1>{t("title")}</h1>
					<p>{organizationId ? t("organizationIntro") : t("accountIntro")}</p>
				</header>
				<section className="privacy-panel" aria-labelledby="privacy-data-title">
					<div className="privacy-setting-row">
						<div>
							<h2 id="privacy-data-title">{t("dataTitle")}</h2>
							<p>
								{organizationId
									? t("organizationExportDescription")
									: t("personalExportDescription")}
							</p>
						</div>
						{organizationId ? (
							<a
								className="privacy-link"
								href={`/${locale}/organizations/${organizationId}/data`}
							>
								{t("export")} <span aria-hidden="true">↗</span>
							</a>
						) : (
							<Button
								variant="secondary"
								disabled={op.busy}
								onClick={() =>
									void run("data", async () =>
										download(await api().privacy.exportAccount({})),
									)
								}
							>
								{t("personalExport")}
							</Button>
						)}
					</div>
					{operationStatus("data")}
				</section>
				{!organizationId && (
					<>
						<div className="privacy-panel">
							<NotificationPreferences />
						</div>
						<section
							className="privacy-panel"
							aria-labelledby="privacy-analytics-title"
						>
							<h2 id="privacy-analytics-title">{t("analyticsTitle")}</h2>
							<p>{t("analyticsDescription")}</p>
							{analyticsState === "loading" && (
								<p role="status">{t("loadingPreferences")}</p>
							)}
							{analyticsState === "error" && (
								<div className="privacy-inline-feedback">
									<p role="status">{t("preferencesUnavailable")}</p>
									<Button
										variant="secondary"
										onClick={() => setRetry((value) => value + 1)}
									>
										{t("retry")}
									</Button>
								</div>
							)}
							{analyticsState === "ready" && analytics && (
								<>
									<label className="privacy-choice" htmlFor="privacy-analytics">
										<Checkbox
											id="privacy-analytics"
											disabled={op.busy}
											checked={analytics.enabled}
											onCheckedChange={(checked) =>
												void run("analytics", async () =>
													setAnalytics(
														await api().analytics.setPreference({
															organizationId: null,
															enabled: checked === true,
															version: analytics.version,
														}),
													),
												)
											}
										/>
										<span>{t("analytics")}</span>
									</label>
									{!analytics.configured && (
										<p className="privacy-note">
											{t("analyticsNotConfigured")}
										</p>
									)}
								</>
							)}
							{operationStatus("analytics")}
						</section>
					</>
				)}
				<section
					className="privacy-panel privacy-danger"
					aria-labelledby="privacy-deletion-title"
				>
					<div className="privacy-danger-heading">
						<h2 id="privacy-deletion-title">
							{organizationId ? t("deleteOrganization") : t("deleteAccount")}
						</h2>
						<p>
							{organizationId
								? t("deleteOrganizationDescription")
								: t("deleteAccountDescription")}
						</p>
					</div>
					<div className="privacy-retention">
						<h3>{t("retentionTitle")}</h3>
						<p>{t("retentionNotice")}</p>
					</div>
					{!request ? (
						<>
							<ol className="privacy-steps">
								<li>
									<div>
										<h3>{t("identityTitle")}</h3>
										<p>{t("identityDescription")}</p>
									</div>
									<a
										className="privacy-link"
										href={`/${locale}/account#reauthenticate`}
									>
										{t("confirmIdentity")}
									</a>
								</li>
								{!organizationId && (
									<li>
										<div className="privacy-setting-row">
											<div>
												<h3>{t("ownershipTitle")}</h3>
												<p>{t("ownershipDescription")}</p>
											</div>
											<Button
												variant="secondary"
												disabled={op.busy}
												onClick={() =>
													void run("deletion", async () =>
														setObligations(
															await api().privacy.previewDeletion({}),
														),
													)
												}
											>
												{t("checkOwnership")}
											</Button>
										</div>
										{obligations && (
											<div className="privacy-ownership">
												<p
													role="status"
													className={blocked ? "privacy-blocked" : undefined}
												>
													{blocked
														? t("ownershipBlocked")
														: t("ownershipReady")}
												</p>
												{obligations.length > 0 && (
													<ul>
														{obligations.map((o) => (
															<li key={o.organizationId}>
																<a
																	className="privacy-link"
																	href={`/${locale}/organizations/${o.organizationId}`}
																>
																	{o.name}
																</a>
																<span
																	className={
																		o.requiresSuccessor
																			? "privacy-blocked"
																			: undefined
																	}
																>
																	{o.requiresSuccessor
																		? t("needsSuccessor")
																		: t("noBlocker")}
																</span>
															</li>
														))}
													</ul>
												)}
											</div>
										)}
									</li>
								)}
							</ol>
							<div className="privacy-action-footer">
								<p id="privacy-prepare-hint">
									{!organizationId && !obligations
										? t("checkOwnershipFirst")
										: blocked
											? t("ownershipBlocked")
											: t("prepareHint")}
								</p>
								<Button
									ref={prepareButton}
									variant="destructive"
									aria-describedby="privacy-prepare-hint"
									disabled={
										op.busy || (!organizationId && (!obligations || blocked))
									}
									onClick={() =>
										void run("deletion", async () =>
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
							</div>
						</>
					) : (
						<section
							className="privacy-confirmation"
							ref={confirmation}
							tabIndex={-1}
							aria-labelledby="privacy-confirmation-title"
						>
							<h3 id="privacy-confirmation-title">{t("confirmationTitle")}</h3>
							<p>{t("saveReceipt")}</p>
							<a
								className="privacy-link"
								href={`/${locale}/deletion#${request.id}.${request.receipt}`}
							>
								{t("deletionStatus")}
							</a>
							<label
								className="privacy-choice privacy-consent"
								htmlFor="privacy-consent"
							>
								<Checkbox
									id="privacy-consent"
									checked={consent}
									disabled={op.busy}
									onCheckedChange={(checked) => setConsent(checked === true)}
								/>
								<span>{t("deletionConsent")}</span>
							</label>
							<div className="privacy-actions">
								<Button
									variant="secondary"
									disabled={op.busy}
									onClick={() =>
										void run("deletion", async () => {
											await api().privacy.cancelDeletion({ id: request.id });
											setRequest(undefined);
											setConsent(false);
										})
									}
								>
									{t("cancelDeletion")}
								</Button>
								<Button
									variant="destructive"
									disabled={op.busy || !consent}
									onClick={() =>
										void run("deletion", async () => {
											await api().privacy.confirmDeletion({ id: request.id });
											window.location.assign(
												`/${locale}/deletion#${request.id}.${request.receipt}`,
											);
										})
									}
								>
									{t("confirmDeletion")}
								</Button>
							</div>
						</section>
					)}
					{operationStatus("deletion")}
				</section>
			</div>
		</DashboardShell>
	);
}
