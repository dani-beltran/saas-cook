"use client";

import { Button, Input } from "@saas-cook/ui";
import { type ComponentProps, useState } from "react";

export function PasswordField({
	showLabel,
	hideLabel,
	className,
	...props
}: Omit<ComponentProps<typeof Input>, "type"> & {
	showLabel: string;
	hideLabel: string;
}) {
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<Input
				{...props}
				type={visible ? "text" : "password"}
				className={`auth-input pr-12 ${className ?? ""}`}
			/>
			<Button
				variant="ghost"
				size="plain"
				type="button"
				className="auth-password-toggle"
				disabled={props.disabled}
				aria-label={visible ? hideLabel : showLabel}
				aria-controls={props.id}
				aria-pressed={visible}
				onClick={() => setVisible(!visible)}
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
					<circle cx="12" cy="12" r="3" />
					{visible && <path d="m3 3 18 18" />}
				</svg>
			</Button>
		</div>
	);
}
