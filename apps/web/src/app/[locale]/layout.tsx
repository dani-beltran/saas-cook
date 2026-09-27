import "@saas-cook/ui/styles.css";
import { publicConfig } from "@saas-cook/config/client";
import { messages } from "@saas-cook/ui/messages";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { DashboardBrand } from "../../components/dashboard-shell";
import { ThemeDocument } from "../../components/theme-document";
import { accountMessages } from "../../i18n/account";

export const metadata: Metadata = {
	title: "SaaS Cook · Foundation",
	description: "Manage your account, organizations, members and security.",
};

export { personalViewport as generateViewport } from "../../lib/server-personal-settings";

export default async function LocaleLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	if (locale !== "en" && locale !== "es") notFound();
	setRequestLocale(locale);
	return (
		<ThemeDocument locale={locale}>
			<NextIntlClientProvider
				locale={locale}
				messages={{ ...messages[locale], Account: accountMessages[locale] }}
				timeZone="UTC"
			>
				<DashboardBrand name={publicConfig(process.env).appName}>
					{children}
				</DashboardBrand>
			</NextIntlClientProvider>
		</ThemeDocument>
	);
}
