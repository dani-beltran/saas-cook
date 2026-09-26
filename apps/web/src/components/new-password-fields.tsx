"use client";
import { Input } from "@common-saas/ui";

export function NewPasswordFields({
	labels,
}: {
	labels: {
		password: string;
		confirmPassword: string;
		passwordHelp: string;
		passwordMismatch: string;
	};
}) {
	return (
		<>
			<label htmlFor="new-password" className="grid gap-2">
				{labels.password}
				<Input
					id="new-password"
					name="password"
					type="password"
					autoComplete="new-password"
					minLength={12}
					maxLength={128}
					aria-describedby="password-help"
					required
					onInput={(event) => {
						const confirmation =
							event.currentTarget.form?.elements.namedItem("confirmPassword");
						if (confirmation instanceof HTMLInputElement)
							confirmation.setCustomValidity("");
					}}
				/>
			</label>
			<p id="password-help" className="text-sm text-muted-foreground">
				{labels.passwordHelp}
			</p>
			<label htmlFor="confirm-password" className="grid gap-2">
				{labels.confirmPassword}
				<Input
					id="confirm-password"
					name="confirmPassword"
					type="password"
					autoComplete="new-password"
					minLength={12}
					maxLength={128}
					required
					onInput={(event) => event.currentTarget.setCustomValidity("")}
					onBlur={(event) => {
						const password =
							event.currentTarget.form?.elements.namedItem("password");
						if (password instanceof HTMLInputElement)
							event.currentTarget.setCustomValidity(
								event.currentTarget.value === password.value
									? ""
									: labels.passwordMismatch,
							);
					}}
				/>
			</label>
		</>
	);
}
