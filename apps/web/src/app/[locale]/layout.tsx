import "@saas-cook/ui/styles.css";
import { publicConfig } from "@saas-cook/config/client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { DashboardBrand } from "../../components/dashboard-shell";
import { ThemeDocument } from "../../components/theme-document";
import { isLocale } from "../../i18n/locales";

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
	if (!isLocale(locale)) notFound();
	setRequestLocale(locale);
	return (
		<ThemeDocument locale={locale}>
			<NextIntlClientProvider
				locale={locale}
				messages={await getMessages({ locale })}
				timeZone="UTC"
			>
				<DashboardBrand name={publicConfig(process.env).appName}>
					{children}
				</DashboardBrand>
			</NextIntlClientProvider>
		</ThemeDocument>
	);
}
