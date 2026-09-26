import "@common-saas/ui/styles.css";
import { messages } from "@common-saas/ui/messages";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Common SaaS · Foundation",
	description: "A synthetic preview of the common SaaS application foundation.",
};

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
		<html lang={locale}>
			<body>
				<NextIntlClientProvider
					locale={locale}
					messages={messages[locale]}
					timeZone="UTC"
				>
					{children}
				</NextIntlClientProvider>
			</body>
		</html>
	);
}
