import { themeAttributes } from "@saas-cook/ui/theme";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import "../style.css";
/** Supplies the isolated English/Spanish operator catalog without customer configuration. */
export default async function Layout({
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
		<html lang={locale} {...themeAttributes({})}>
			<body>
				<NextIntlClientProvider
					locale={locale}
					messages={await getMessages()}
					timeZone="UTC"
				>
					{children}
				</NextIntlClientProvider>
			</body>
		</html>
	);
}
