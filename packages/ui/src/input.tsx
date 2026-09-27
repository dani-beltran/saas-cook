import type * as React from "react";
import { cn } from "./classes";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"h-control w-full min-w-0 rounded-md border border-input bg-input-background px-3 py-1 text-base shadow-xs transition-shadow selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
				"focus-visible:border-ring focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
				"aria-invalid:border-destructive",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
