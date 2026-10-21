"use client";
import { Button } from "@saas-cook/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Status, useOperation } from "../../components/feature-ui";
import { api } from "../../lib/api-client";
import { PublicPageShell } from "../public-pages/shell";
/**
 * Displays the deletion request identified by the scoped receipt in the URL fragment.
 * The receipt grants status access only. Nothing is submitted before Check status is clicked.
 * @returns A public status page; invalid receipts and provider failures use localized status feedback.
 */
export function DeletionStatusPage() {
	const op = useOperation();
	const t = useTranslations("Privacy");
	const [state, setState] =
		useState<
			Awaited<ReturnType<ReturnType<typeof api>["privacy"]["deletionStatus"]>>
		>();
	return (
		<PublicPageShell>
			<h1>{t("deletionStatus")}</h1>
			<Status {...op} />
			<Button
				disabled={op.busy}
				onClick={() =>
					void op.run(async () => {
						const receipt = window.location.hash.slice(1);
						const split = receipt.indexOf(".");
						setState(
							await api().privacy.deletionStatus({
								id: receipt.slice(0, split),
								receipt: receipt.slice(split + 1),
							}),
						);
					})
				}
			>
				{t("checkStatus")}
			</Button>
			{state && (
				<section className="feature-card">
					<p>{state.state}</p>
					<p>{t("completedSteps", { steps: state.steps.join(", ") || "—" })}</p>
					<p>{t("retained", { categories: state.retained.join(", ") })}</p>
					<p>{t("backupNotice")}</p>
				</section>
			)}
		</PublicPageShell>
	);
}
