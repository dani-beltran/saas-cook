"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "./button";
import { Input } from "./input";

/** UI-only example; feature mutations must repeat validation on the server. */
export function SampleForm() {
	const t = useTranslations("Form");
	const fieldId = useId();
	const schema = z.object({
		name: z.string().trim().min(2, t("required")).max(80, t("tooLong")),
	});
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitSuccessful },
	} = useForm<z.infer<typeof schema>>({
		resolver: zodResolver(schema),
		defaultValues: { name: "" },
	});

	return (
		<form
			className="grid gap-5"
			noValidate
			onSubmit={handleSubmit(() => undefined)}
		>
			<div className="grid gap-2">
				<label className="text-sm font-medium" htmlFor={fieldId}>
					{t("name")}
				</label>
				<Input
					id={fieldId}
					placeholder={t("placeholder")}
					autoComplete="off"
					aria-invalid={Boolean(errors.name)}
					aria-describedby={`${fieldId}-hint${errors.name ? ` ${fieldId}-error` : ""}`}
					{...register("name")}
				/>
				<p className="text-sm text-muted-foreground" id={`${fieldId}-hint`}>
					{t("hint")}
				</p>
				{errors.name && (
					<p
						className="text-sm text-destructive"
						id={`${fieldId}-error`}
						role="alert"
					>
						{errors.name.message}
					</p>
				)}
			</div>
			<Button type="submit" className="justify-self-start">
				{t("submit")}
			</Button>
			{isSubmitSuccessful && (
				<p
					className="rounded-md border border-border bg-muted p-3 text-sm"
					role="status"
				>
					{t("success")}
				</p>
			)}
		</form>
	);
}
