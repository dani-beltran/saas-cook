import { getTranslations } from "next-intl/server";
import "../../../features/completion/completion.css";
export default async function Help({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	const t = await getTranslations({ locale, namespace: "Phase6.Help" });
	return (
		<main className="completion-public">
			<nav>
				<a href={`/${locale}/account`}>{t("back")}</a>
			</nav>
			<h1>{t("title")}</h1>
			<section className="completion-card">
				<h2>{t("dataTitle")}</h2>
				<p>{t("dataDescription")}</p>
				<p>{t("exportsDescription")}</p>
			</section>
			<section className="completion-card">
				<h2>{t("privacyTitle")}</h2>
				<p>{t("privacyDescription")}</p>
				<a href={`/${locale}/privacy`}>{t("openPrivacy")}</a>
			</section>
			<section className="completion-card">
				<h2>{t("integrationsTitle")}</h2>
				<p>{t("integrationsDescription")}</p>
			</section>
			<section className="completion-card">
				<h2>{t("accessTitle")}</h2>
				<p>{t("accessDescription")}</p>
			</section>
		</main>
	);
}
