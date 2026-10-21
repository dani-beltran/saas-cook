import type { ReactNode } from "react";
import "../../components/feature-ui.css";
import "./public-pages.css";

/**
 * Applies the shared layout and styles for public information and receipt pages.
 * @param props - children contains the page content; the shell performs no authorization.
 * @returns A centered main landmark with shared feature styles.
 */
export function PublicPageShell({ children }: { children: ReactNode }) {
	return <main className="public-page">{children}</main>;
}
