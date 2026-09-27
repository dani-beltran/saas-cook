import "@common-saas/ui/styles.css";
import type { ReactNode } from "react";
import { ThemeDocument } from "../../components/theme-document";

export { productViewport as viewport } from "../../product-theme";

export default function AuthLayout({ children }: { children: ReactNode }) {
	return <ThemeDocument locale="en">{children}</ThemeDocument>;
}
