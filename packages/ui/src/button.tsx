import type { ComponentProps } from "react";
import { cn } from "./classes";

const variants = {
	primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
	secondary:
		"border border-input bg-secondary text-secondary-foreground hover:bg-secondary-hover",
	destructive:
		"bg-destructive text-destructive-foreground hover:bg-destructive-hover",
	ghost: "bg-transparent text-foreground hover:bg-muted",
	link: "bg-transparent text-primary underline-offset-4 hover:underline",
} as const;

const sizes = {
	default: "min-h-control px-4 py-control-y",
	plain: "min-h-6 min-w-6 p-0",
	icon: "size-control p-0",
} as const;

export function Button({
	className,
	type = "button",
	variant = "primary",
	size = "default",
	...props
}: ComponentProps<"button"> & {
	variant?: keyof typeof variants;
	size?: keyof typeof sizes;
}) {
	return (
		<button
			type={type}
			data-slot="button"
			className={cn(
				"inline-flex items-center justify-center rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
				variants[variant],
				sizes[size],
				className,
			)}
			{...props}
		/>
	);
}
