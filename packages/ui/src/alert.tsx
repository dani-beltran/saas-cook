import type { ComponentProps } from "react";
import { cn } from "./classes";

/** Announces feedback in a live region; variant chooses tone and role may override the default polite status. */
export function Alert({
	className,
	variant = "neutral",
	...props
}: ComponentProps<"div"> & { variant?: "neutral" | "success" | "error" }) {
	return (
		<div
			data-slot="alert"
			role="status"
			aria-atomic="true"
			className={cn(
				"rounded-md border px-4 py-3 text-sm leading-relaxed",
				{
					neutral: "border-border bg-background text-muted-foreground",
					success: "border-border bg-success-surface text-success-foreground",
					error: "border-destructive bg-danger-surface text-destructive",
				}[variant],
				className,
			)}
			{...props}
		/>
	);
}
