import type { ComponentProps } from "react";
import { cn } from "./classes";

const variants = {
	primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
	secondary:
		"border border-input bg-secondary text-secondary-foreground hover:bg-secondary-hover",
	destructive:
		"bg-destructive text-destructive-foreground hover:bg-destructive-hover",
} as const;

export function Button({
	className,
	type = "button",
	variant = "primary",
	...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
	return (
		<button
			type={type}
			data-slot="button"
			className={cn(
				"inline-flex min-h-control items-center justify-center rounded-md px-4 py-control-y text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
				variants[variant],
				className,
			)}
			{...props}
		/>
	);
}
