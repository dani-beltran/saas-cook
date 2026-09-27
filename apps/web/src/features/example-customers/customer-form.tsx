"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@saas-cook/ui";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { CustomerCopy } from "./messages";

export type CustomerFormValues = {
	name: string;
	email: string;
	company: string;
	status: "lead" | "active" | "inactive";
};
export function CustomerForm({
	copy,
	initial,
	busy = false,
	onSave,
	onCancel,
}: {
	copy: CustomerCopy;
	initial?: CustomerFormValues;
	busy?: boolean;
	onSave: (value: CustomerFormValues) => Promise<void>;
	onCancel: () => void;
}) {
	const id = useId();
	const schema = z.strictObject({
		name: z.string().trim().min(1, copy.nameInvalid).max(120, copy.nameInvalid),
		email: z
			.string()
			.trim()
			.max(254, copy.emailInvalid)
			.pipe(z.email(copy.emailInvalid)),
		company: z.string().trim().max(120, copy.companyInvalid),
		status: z.enum(["lead", "active", "inactive"], {
			error: copy.statusInvalid,
		}),
	});
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<CustomerFormValues>({
		resolver: zodResolver(schema),
		defaultValues: initial ?? {
			name: "",
			email: "",
			company: "",
			status: "lead",
		},
	});
	const pending = busy || isSubmitting;
	return (
		<form
			className="customers-form"
			noValidate
			aria-busy={pending}
			onSubmit={handleSubmit(async (value) => {
				if (!pending) await onSave(value);
			})}
		>
			<p className="customers-muted">{copy.formHint}</p>
			{(["name", "email", "company"] as const).map((field) => (
				<div className="customers-field" key={field}>
					<label htmlFor={`${id}-${field}`}>
						{copy[field]}{" "}
						{field === "company" && (
							<span className="customers-muted">({copy.optional})</span>
						)}
					</label>
					<Input
						id={`${id}-${field}`}
						type={field === "email" ? "email" : "text"}
						autoComplete="off"
						disabled={pending}
						aria-required={field !== "company"}
						aria-invalid={Boolean(errors[field])}
						aria-describedby={
							errors[field] ? `${id}-${field}-error` : undefined
						}
						{...register(field)}
					/>
					{errors[field] && (
						<p
							id={`${id}-${field}-error`}
							role="alert"
							className="customers-error"
						>
							{errors[field]?.message}
						</p>
					)}
				</div>
			))}
			<div className="customers-field">
				<label htmlFor={`${id}-status`}>{copy.status}</label>
				<select id={`${id}-status`} disabled={pending} {...register("status")}>
					<option value="lead">{copy.lead}</option>
					<option value="active">{copy.active}</option>
					<option value="inactive">{copy.inactive}</option>
				</select>
			</div>
			<div className="customers-dialog-actions">
				<Button type="submit" disabled={pending}>
					{pending ? copy.saving : copy.save}
				</Button>
				<Button
					className="customers-secondary"
					disabled={pending}
					onClick={onCancel}
				>
					{copy.cancel}
				</Button>
			</div>
		</form>
	);
}
