import { themeAttributes } from "@common-saas/ui/theme";
import type { ReactNode } from "react";
import { productTheme } from "../product-theme";

export function ThemeDocument({
	locale,
	children,
}: {
	locale: "en" | "es";
	children: ReactNode;
}) {
	return (
		<html lang={locale} {...themeAttributes(productTheme)}>
			<body>{children}</body>
		</html>
	);
}
