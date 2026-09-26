"use client";
import { useState } from "react";
import { PasswordField } from "./password-field";

export function NewPasswordFields({
	labels,
}: {
	labels: {
		password: string;
		confirmPassword: string;
		passwordHelp: string;
		passwordMismatch: string;
		showPassword: string;
		hidePassword: string;
		showConfirmPassword: string;
		hideConfirmPassword: string;
	};
}) {
	const [passwordError, setPasswordError] = useState(false);
	const [confirmationError, setConfirmationError] = useState(false);
	return (
		<>
			<div className="grid gap-2">
				<label htmlFor="new-password">{labels.password}</label>
				<PasswordField
					id="new-password"
					name="password"
					autoComplete="new-password"
					minLength={12}
					maxLength={128}
					aria-describedby="password-help"
					aria-invalid={passwordError || undefined}
					required
					showLabel={labels.showPassword}
					hideLabel={labels.hidePassword}
					onInvalid={() => setPasswordError(true)}
					onInput={(event) => {
						setPasswordError(false);
						setConfirmationError(false);
						const confirmation =
							event.currentTarget.form?.elements.namedItem("confirmPassword");
						if (confirmation instanceof HTMLInputElement)
							confirmation.setCustomValidity("");
					}}
				/>
				<p
					id="password-help"
					className={`text-xs leading-relaxed ${passwordError ? "text-destructive" : "text-muted-foreground"}`}
				>
					{labels.passwordHelp}
				</p>
			</div>
			<div className="grid gap-2">
				<label htmlFor="confirm-password">{labels.confirmPassword}</label>
				<PasswordField
					id="confirm-password"
					name="confirmPassword"
					autoComplete="new-password"
					minLength={12}
					maxLength={128}
					required
					showLabel={labels.showConfirmPassword}
					hideLabel={labels.hideConfirmPassword}
					aria-invalid={confirmationError || undefined}
					aria-describedby={
						confirmationError ? "confirmation-error" : undefined
					}
					onInvalid={() => setConfirmationError(true)}
					onInput={(event) => {
						event.currentTarget.setCustomValidity("");
						setConfirmationError(false);
					}}
					onBlur={(event) => {
						const password =
							event.currentTarget.form?.elements.namedItem("password");
						if (
							password instanceof HTMLInputElement &&
							event.currentTarget.value
						) {
							const mismatch = event.currentTarget.value !== password.value;
							event.currentTarget.setCustomValidity(
								mismatch ? labels.passwordMismatch : "",
							);
							setConfirmationError(mismatch);
						}
					}}
				/>
				{confirmationError && (
					<p
						id="confirmation-error"
						role="alert"
						className="text-xs text-destructive"
					>
						{labels.passwordMismatch}
					</p>
				)}
			</div>
		</>
	);
}
