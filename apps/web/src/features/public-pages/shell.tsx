import type { ReactNode } from "react";
import "../../components/feature-ui.css";
import "./public-pages.css";

/**
 * Applies the shared layout and styles for public information and receipt pages.
 * @param props - children contains page content; optional className adds page-specific layout styles.
 * The shell performs no authorization.
 * @returns A centered main landmark with shared feature styles.
 */
export function PublicPageShell({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return <main className={`public-page ${className}`.trim()}>{children}</main>;
}
