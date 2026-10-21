"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { customerFormFields as schema } from "@saas-cook/api-contracts/example-customers";
import { Button, Input, NativeSelect, NativeSelectOption } from "@saas-cook/ui";
import { useId } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import type { CustomerCopy } from "./messages";

export type CustomerFormValues = z.infer<typeof schema>;
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
							{copy[`${field}Invalid`]}
						</p>
					)}
				</div>
			))}
			<div className="customers-field">
				<label htmlFor={`${id}-status`}>{copy.status}</label>
				<NativeSelect
					id={`${id}-status`}
					disabled={pending}
					{...register("status")}
				>
					<NativeSelectOption value="lead">{copy.lead}</NativeSelectOption>
					<NativeSelectOption value="active">{copy.active}</NativeSelectOption>
					<NativeSelectOption value="inactive">
						{copy.inactive}
					</NativeSelectOption>
				</NativeSelect>
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
