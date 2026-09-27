import { themeAttributes } from "@common-saas/ui/theme";
import type { ReactNode } from "react";
import { serverPersonalSettings } from "../lib/server-personal-settings";
import { productTheme } from "../product-theme";
import { PersonalSettingsProvider } from "./personal-settings-provider";

export async function ThemeDocument({
	locale,
	children,
}: {
	locale: "en" | "es";
	children: ReactNode;
}) {
	const settings = await serverPersonalSettings();
	const theme = { ...productTheme, mode: settings?.mode ?? productTheme.mode };
	return (
		<html lang={locale} {...themeAttributes(theme)}>
			<body>
				<PersonalSettingsProvider initial={settings}>
					{children}
				</PersonalSettingsProvider>
			</body>
		</html>
	);
}
