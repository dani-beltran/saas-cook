import { publicConfig } from "@saas-cook/config/client";
import { getTranslations } from "next-intl/server";
import "../../../features/completion/completion.css";
export default async function About({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	const t = await getTranslations({ locale, namespace: "Phase6.About" });
	const config = publicConfig(process.env);
	return (
		<main className="completion-public">
			<nav>
				<a href={`/${locale}/help`}>{t("help")}</a>
			</nav>
			<h1>{config.appName}</h1>
			<p>{t("description")}</p>
			<div className="completion-actions">
				<a href={`/${locale}/account`}>{t("signIn")}</a>
				<a href={`/${locale}/help`}>{t("howItWorks")}</a>
			</div>
			<section className="completion-card">
				<h2>{t("controlsTitle")}</h2>
				<p>{t("controlsDescription")}</p>
			</section>
			<p>{t("configurationNotice")}</p>
		</main>
	);
}
