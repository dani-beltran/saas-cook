"use client";
import { Button } from "@saas-cook/ui";
import { useTranslations } from "next-intl";
import { Status, useOperation } from "../../components/feature-ui";
import { api } from "../../lib/api-client";
import { PublicPageShell } from "../public-pages/shell";
/**
 * Confirms optional-email unsubscribe using the scoped receipt in the URL fragment.
 * The receipt cannot authorize account or organization actions.
 * @returns A public confirmation page that submits only on click and displays localized failures.
 */
export function UnsubscribePage() {
	const op = useOperation();
	const t = useTranslations("Notifications.Unsubscribe");
	return (
		<PublicPageShell>
			<h1>{t("title")}</h1>
			<Status {...op} />
			<Button
				disabled={op.busy}
				onClick={() =>
					void op.run(async () => {
						await api().notifications.unsubscribe({
							receipt: window.location.hash.slice(1),
						});
					})
				}
			>
				{t("confirm")}
			</Button>
		</PublicPageShell>
	);
}
