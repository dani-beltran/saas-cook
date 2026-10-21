import { getTranslations } from "next-intl/server";
import { PublicPageShell } from "./shell";
/**
 * Loads translated Help content for a locale validated by the route layout.
 * @param props - locale selects the server-side message catalog.
 * @returns The public page content inside its shared shell.
 * Rendering/configuration failures propagate to the framework's route error handling.
 */
export async function HelpPage({ locale }: { locale: string }) {
	const t = await getTranslations({ locale, namespace: "PublicPages.Help" });
	return (
		<PublicPageShell>
			<nav>
				<a href={`/${locale}/account`}>{t("back")}</a>
			</nav>
			<h1>{t("title")}</h1>
			<section className="feature-card">
				<h2>{t("dataTitle")}</h2>
				<p>{t("dataDescription")}</p>
				<p>{t("exportsDescription")}</p>
			</section>
			<section className="feature-card">
				<h2>{t("privacyTitle")}</h2>
				<p>{t("privacyDescription")}</p>
				<a href={`/${locale}/privacy`}>{t("openPrivacy")}</a>
			</section>
			<section className="feature-card">
				<h2>{t("integrationsTitle")}</h2>
				<p>{t("integrationsDescription")}</p>
			</section>
			<section className="feature-card">
				<h2>{t("accessTitle")}</h2>
				<p>{t("accessDescription")}</p>
			</section>
		</PublicPageShell>
	);
}
