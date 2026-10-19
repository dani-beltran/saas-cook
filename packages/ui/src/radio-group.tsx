"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { CircleIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "./classes";

function RadioGroup({
	className,
	onKeyDown,
	...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
	return (
		<RadioGroupPrimitive.Root
			data-slot="radio-group"
			className={cn("grid gap-3", className)}
			{...props}
			onKeyDown={(event) => {
				onKeyDown?.(event);
				if (
					!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
						event.key,
					) ||
					event.altKey ||
					event.ctrlKey ||
					event.metaKey ||
					event.shiftKey
				)
					return;
				const group = event.currentTarget;
				const previous = event.target;
				// Radix moves focus asynchronously. A fast keyup can clear its arrow
				// flag before focus arrives, so select that item if Radix has not.
				setTimeout(() => {
					const focused = document.activeElement;
					if (
						group.isConnected &&
						focused instanceof HTMLButtonElement &&
						focused !== previous &&
						focused.closest('[data-slot="radio-group"]') === group &&
						focused.getAttribute("aria-checked") === "false" &&
						!focused.disabled
					)
						focused.click();
				}, 0);
			}}
		/>
	);
}

function RadioGroupItem({
	className,
	...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
	return (
		<RadioGroupPrimitive.Item
			data-slot="radio-group-item"
			className={cn(
				"aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				className,
			)}
			{...props}
		>
			<RadioGroupPrimitive.Indicator
				data-slot="radio-group-indicator"
				className="relative flex items-center justify-center"
			>
				<CircleIcon className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-primary" />
			</RadioGroupPrimitive.Indicator>
		</RadioGroupPrimitive.Item>
	);
}

export { RadioGroup, RadioGroupItem };
