"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	type ProjectFormValues,
	projectFormFields as schema,
} from "@saas-cook/api-contracts/inputs/resources";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useForm } from "react-hook-form";

export type { ProjectFormValues } from "@saas-cook/api-contracts/inputs/resources";

import { Button } from "./button";
import { Input } from "./input";
import { NativeSelect, NativeSelectOption } from "./native-select";
import { Textarea } from "./textarea";

export function ProjectForm({
	initial,
	busy = false,
	onSave,
	onCancel,
}: {
	initial?: ProjectFormValues;
	busy?: boolean;
	onSave: (value: ProjectFormValues) => Promise<void>;
	onCancel?: () => void;
}) {
	const t = useTranslations("Projects");
	const id = useId();
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<ProjectFormValues>({
		resolver: zodResolver(schema),
		defaultValues: initial ?? {
			name: "",
			slug: "",
			description: "",
			status: "active",
		},
	});
	const pending = busy || isSubmitting;
	return (
		<form
			className="grid gap-field text-sm"
			aria-busy={pending}
			noValidate
			onSubmit={handleSubmit(async (value) => {
				if (!pending) await onSave(value);
			})}
		>
			<div className="grid gap-2">
				<label htmlFor={`${id}-name`}>{t("name")}</label>
				<Input
					id={`${id}-name`}
					autoComplete="off"
					disabled={pending}
					aria-invalid={Boolean(errors.name)}
					aria-describedby={errors.name ? `${id}-name-error` : undefined}
					{...register("name")}
				/>
				{errors.name && (
					<p id={`${id}-name-error`} role="alert" className="text-destructive">
						{t("nameInvalid")}
					</p>
				)}
			</div>
			{!initial && (
				<div className="grid gap-2">
					<label htmlFor={`${id}-slug`}>{t("slug")}</label>
					<Input
						id={`${id}-slug`}
						disabled={pending}
						autoComplete="off"
						aria-invalid={Boolean(errors.slug)}
						aria-describedby={`${id}-slug-hint${errors.slug ? ` ${id}-slug-error` : ""}`}
						{...register("slug")}
					/>
					<p id={`${id}-slug-hint`} className="text-sm text-muted-foreground">
						{t("slugHint")}
					</p>
					{errors.slug && (
						<p
							id={`${id}-slug-error`}
							role="alert"
							className="text-destructive"
						>
							{t("slugInvalid")}
						</p>
					)}
				</div>
			)}
			<div className="grid gap-2">
				<label htmlFor={`${id}-description`}>{t("description")}</label>
				<Textarea
					id={`${id}-description`}
					className="min-h-28 resize-y rounded-md border border-input bg-background p-3 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
					disabled={pending}
					aria-invalid={Boolean(errors.description)}
					aria-describedby={
						errors.description ? `${id}-description-error` : undefined
					}
					{...register("description")}
				/>
				{errors.description && (
					<p
						id={`${id}-description-error`}
						role="alert"
						className="text-destructive"
					>
						{t("descriptionInvalid")}
					</p>
				)}
			</div>
			{initial && (
				<div className="grid gap-2">
					<label htmlFor={`${id}-status`}>{t("status")}</label>
					<NativeSelect
						id={`${id}-status`}
						disabled={pending}
						className="min-h-10 rounded-md border border-input bg-background p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						{...register("status")}
					>
						<NativeSelectOption value="active">
							{t("active")}
						</NativeSelectOption>
						<NativeSelectOption value="completed">
							{t("completed")}
						</NativeSelectOption>
						<NativeSelectOption value="archived">
							{t("archived")}
						</NativeSelectOption>
					</NativeSelect>
				</div>
			)}
			<div className="flex flex-wrap gap-3 border-t border-border pt-5">
				<Button type="submit" disabled={pending}>
					{pending ? t("saving") : initial ? t("save") : t("create")}
				</Button>
				{onCancel && (
					<Button
						type="button"
						className="border border-border bg-background text-foreground hover:bg-muted"
						disabled={pending}
						onClick={onCancel}
					>
						{t("cancel")}
					</Button>
				)}
			</div>
		</form>
	);
}
