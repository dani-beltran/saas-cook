import "@saas-cook/ui/styles.css";
import type { ReactNode } from "react";
import { ThemeDocument } from "../../components/theme-document";

export { personalViewport as generateViewport } from "../../lib/server-personal-settings";

export default function AuthLayout({ children }: { children: ReactNode }) {
	return <ThemeDocument locale="en">{children}</ThemeDocument>;
}
