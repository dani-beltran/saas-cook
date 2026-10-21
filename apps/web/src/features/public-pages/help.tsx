import { publicConfig } from "@saas-cook/config/client";
import { getTranslations } from "next-intl/server";
import { locales } from "../../i18n/locales";
import { PublicPageShell } from "./shell";
import "./help.css";

const guides = [
	{
		id: "getting-started",
		key: "gettingStarted",
		steps: ["account", "verify", "signIn", "organization"],
	},
	{
		id: "organizations",
		key: "organizations",
		steps: ["context", "members", "project", "find"],
	},
	{
		id: "files",
		key: "files",
		steps: ["open", "choose", "verify", "download"],
	},
	{
		id: "imports",
		key: "imports",
		steps: ["prepare", "upload", "select", "map", "validate", "start"],
	},
	{
		id: "exports",
		key: "exports",
		steps: ["choose", "wait", "download", "refresh"],
	},
	{
		id: "privacy",
		key: "privacy",
		steps: ["open", "notifications", "analytics", "personalExport"],
	},
	{
		id: "deletion",
		key: "deletion",
		steps: ["export", "ownership", "identity", "prepare", "receipt", "confirm"],
	},
	{
		id: "api-keys",
		key: "keys",
		steps: ["open", "account", "issue", "rotate"],
	},
	{
		id: "integrations",
		key: "integrations",
		steps: ["prepare", "webhook", "integration", "audit"],
	},
	{
		id: "billing",
		key: "billing",
		steps: ["review", "change", "usage", "invoices"],
	},
] as const;
const questions = [
	"signIn",
	"access",
	"file",
	"job",
	"export",
	"preference",
] as const;

/**
 * Loads localized product guides and an in-page topic index.
 * @param props - locale selects the catalog validated by the route layout.
 * @returns A public, server-rendered Help center with accessible anchor navigation.
 * Rendering/configuration failures propagate to the framework's route error handling.
 */
export async function HelpPage({ locale }: { locale: string }) {
	const t = await getTranslations({ locale, namespace: "PublicPages.Help" });
	const { appName } = publicConfig(process.env);
	return (
		<PublicPageShell className="help-page">
			<a className="help-skip" href="#help-guides">
				{t("skip")}
			</a>
			<header className="help-topbar">
				<a className="help-brand" href={`/${locale}/about`}>
					{appName}
					<span>{t("documentation")}</span>
				</a>
				<nav aria-label={t("pageNavigation")}>
					<nav className="help-languages" aria-label={t("language")}>
						{locales.map((language) => (
							<a
								key={language}
								href={`/${language}/help`}
								lang={language}
								hrefLang={language}
								aria-current={locale === language ? "page" : undefined}
							>
								{t(`languages.${language}`)}
							</a>
						))}
					</nav>
					<a className="help-app-link" href={`/${locale}/account`}>
						{t("back")}
						<span aria-hidden="true">↗</span>
					</a>
				</nav>
			</header>
			<div className="help-hero" id="help-top">
				<p className="help-eyebrow">{t("eyebrow")}</p>
				<h1>{t("title")}</h1>
				<p>{t("intro")}</p>
				<div className="help-shortcuts">
					{["gettingStarted", "imports", "troubleshooting"].map(
						(key, index) => (
							<a
								key={key}
								href={`#${["getting-started", "imports", "troubleshooting"][index]}`}
							>
								<span>{t(`shortcuts.${key}`)}</span>
								<span aria-hidden="true">↗</span>
							</a>
						),
					)}
				</div>
			</div>
			<div className="help-layout">
				<nav
					className="help-index"
					id="help-index"
					tabIndex={-1}
					aria-label={t("index")}
				>
					<h2>{t("index")}</h2>
					<ol>
						{guides.map(({ id, key }) => (
							<li key={id}>
								<a href={`#${id}`}>{t(`${key}.title`)}</a>
							</li>
						))}
						<li>
							<a href="#troubleshooting">{t("troubleshooting.title")}</a>
						</li>
						<li>
							<a href="#contact">{t("contact.title")}</a>
						</li>
					</ol>
				</nav>
				<div className="help-guides" id="help-guides" tabIndex={-1}>
					<div className="help-availability">
						<p>{t("availability")}</p>
					</div>
					{guides.map(({ id, key, steps }, index) => (
						<section className="help-article" key={id} aria-labelledby={id}>
							<div className="help-article-heading">
								<span aria-hidden="true">
									{String(index + 1).padStart(2, "0")}
								</span>
								<h2 id={id} tabIndex={-1}>
									{t(`${key}.title`)}
								</h2>
							</div>
							<p className="help-article-intro">{t(`${key}.intro`)}</p>
							<ol className="help-steps">
								{steps.map((step) => (
									<li key={step}>{t(`${key}.steps.${step}`)}</li>
								))}
							</ol>
							{id === "imports" && (
								<figure className="help-example">
									<figcaption>{t("imports.exampleTitle")}</figcaption>
									<pre>
										<code>{t("imports.example")}</code>
									</pre>
									<p>{t("imports.exampleHint")}</p>
								</figure>
							)}
							<p className="help-note">{t(`${key}.note`)}</p>
							{id === "getting-started" && (
								<a className="help-text-link" href={`/${locale}/account`}>
									{t("gettingStarted.action")} <span aria-hidden="true">→</span>
								</a>
							)}
							{id === "privacy" && (
								<a
									className="help-text-link"
									href={`/${locale}/account#privacy`}
								>
									{t("openPrivacy")} <span aria-hidden="true">→</span>
								</a>
							)}
							<a className="help-return-index" href="#help-index">
								{t("backToIndex")} <span aria-hidden="true">↑</span>
							</a>
						</section>
					))}
					<section className="help-article" aria-labelledby="troubleshooting">
						<h2 id="troubleshooting" tabIndex={-1}>
							{t("troubleshooting.title")}
						</h2>
						<p className="help-article-intro">{t("troubleshooting.intro")}</p>
						<div className="help-questions">
							{questions.map((question) => (
								<details key={question}>
									<summary>{t(`troubleshooting.${question}.question`)}</summary>
									<p>{t(`troubleshooting.${question}.answer`)}</p>
								</details>
							))}
						</div>
					</section>
					<section className="help-contact" aria-labelledby="contact">
						<h2 id="contact" tabIndex={-1}>
							{t("contact.title")}
						</h2>
						<p>{t("contact.intro")}</p>
						<ul>
							{["context", "steps", "identifier"].map((key) => (
								<li key={key}>{t(`contact.${key}`)}</li>
							))}
						</ul>
						<p className="help-note">{t("contact.security")}</p>
					</section>
					<footer className="help-footer">
						<a className="help-text-link" href="#help-top">
							{t("backToTop")} <span aria-hidden="true">↑</span>
						</a>
					</footer>
				</div>
			</div>
		</PublicPageShell>
	);
}
