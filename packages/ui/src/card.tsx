import type { ComponentProps } from "react";
import { cn } from "./classes";

/** Renders a themed panel; props supply semantic attributes and optional layout classes. */
export function Card({ className, ...props }: ComponentProps<"section">) {
	return (
		<section
			data-slot="card"
			className={cn(
				"min-w-0 rounded-xl border border-border bg-card text-card-foreground shadow-sm",
				className,
			)}
			{...props}
		/>
	);
}

/** Groups a panel's heading and description; accepts ordinary div attributes. */
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn("grid gap-2 p-6", className)}
			{...props}
		/>
	);
}

/** Renders a level-two panel heading; children provide the accessible title. */
export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
	return (
		<h2
			data-slot="card-title"
			className={cn("text-base font-semibold tracking-tight", className)}
			{...props}
		/>
	);
}

/** Renders supporting panel text; accepts ordinary paragraph attributes. */
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
	return (
		<p
			data-slot="card-description"
			className={cn("text-sm leading-relaxed text-muted-foreground", className)}
			{...props}
		/>
	);
}

/** Contains panel content with padding aligned to CardHeader; accepts div attributes. */
export function CardContent({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="card-content"
			className={cn("px-6 pb-6", className)}
			{...props}
		/>
	);
}
