import type { ComponentProps } from "react";
import { cn } from "./classes";

/** Displays a compact label; variant selects a neutral, accent or success treatment, never authority. */
export function Badge({
	className,
	variant = "neutral",
	...props
}: ComponentProps<"span"> & { variant?: "neutral" | "accent" | "success" }) {
	return (
		<span
			data-slot="badge"
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
				{
					neutral: "border-border bg-background text-muted-foreground",
					accent: "border-transparent bg-accent text-accent-foreground",
					success:
						"border-transparent bg-success-surface text-success-foreground",
				}[variant],
				className,
			)}
			{...props}
		/>
	);
}
