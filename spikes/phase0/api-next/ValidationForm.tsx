"use client";
import { useTranslations, NextIntlClientProvider } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
const formSchema = z.object({ name: z.string().min(1, "Enter a name") });
function Form() {
	const t = useTranslations();
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitSuccessful },
	} = useForm({
		resolver: zodResolver(formSchema),
		defaultValues: { name: "" },
	});
	return (
		<form
			className="grid max-w-sm gap-3 rounded border p-6"
			onSubmit={handleSubmit(() => undefined)}
		>
			<label htmlFor="project-name">{t("name")}</label>
			<input
				id="project-name"
				className="rounded border p-2"
				aria-invalid={Boolean(errors.name)}
				aria-describedby={errors.name ? "name-error" : undefined}
				{...register("name")}
			/>
			{errors.name && (
				<p id="name-error" role="alert">
					{errors.name.message}
				</p>
			)}
			<button type="submit" className="rounded bg-slate-900 p-2 text-white">
				{t("validate")}
			</button>
			{isSubmitSuccessful && <p role="status">{t("success")}</p>}
		</form>
	);
}
export function ValidationForm() {
	return (
		<NextIntlClientProvider
			locale="en"
			timeZone="UTC"
			messages={{
				name: "Project name",
				validate: "Validate",
				success: "Valid input",
			}}
		>
			<Form />
		</NextIntlClientProvider>
	);
}
