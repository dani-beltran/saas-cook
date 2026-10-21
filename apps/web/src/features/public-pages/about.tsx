import { publicConfig } from "@saas-cook/config/client";
import { getTranslations } from "next-intl/server";
import { PublicPageShell } from "./shell";
/**
 * Loads translated About content for a locale validated by the route layout.
 * @param props - locale selects the server-side message catalog.
 * @returns The public page content inside its shared shell.
 * Rendering/configuration failures propagate to the framework's route error handling.
 */
export async function AboutPage({ locale }: { locale: string }) {
	const t = await getTranslations({ locale, namespace: "PublicPages.About" });
	const config = publicConfig(process.env);
	return (
		<PublicPageShell>
			<nav>
				<a href={`/${locale}/help`}>{t("help")}</a>
			</nav>
			<h1>{config.appName}</h1>
			<p>{t("description")}</p>
			<div className="feature-actions">
				<a href={`/${locale}/account`}>{t("signIn")}</a>
				<a href={`/${locale}/help`}>{t("howItWorks")}</a>
			</div>
			<section className="feature-card">
				<h2>{t("controlsTitle")}</h2>
				<p>{t("controlsDescription")}</p>
			</section>
			<p>{t("configurationNotice")}</p>
		</PublicPageShell>
	);
}
