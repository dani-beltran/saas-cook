"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "./button";
import { Input } from "./input";

export interface ProjectFormValues {
	name: string;
	slug: string;
	description: string;
	workspaceId: string;
	status: "active" | "completed" | "archived";
}
export function ProjectForm({
	initial,
	workspaces = [],
	busy = false,
	onSave,
	onCancel,
}: {
	initial?: ProjectFormValues;
	workspaces?: { id: string; name: string; archivedAt: string | null }[];
	busy?: boolean;
	onSave: (value: ProjectFormValues) => Promise<void>;
	onCancel?: () => void;
}) {
	const t = useTranslations("Projects");
	const id = useId();
	const schema = z.object({
		name: z.string().trim().min(2, t("nameInvalid")).max(80, t("nameInvalid")),
		slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, t("slugInvalid")),
		description: z.string().max(4000, t("descriptionInvalid")),
		workspaceId: z
			.string()
			.refine(
				(value) =>
					Boolean(initial) ||
					value === "" ||
					workspaces.some(
						(workspace) => workspace.id === value && !workspace.archivedAt,
					),
				t("workspaceInvalid"),
			),
		status: z.enum(["active", "completed", "archived"]),
	});
	const {
		register,
		handleSubmit,
		watch,
		formState: { errors, isSubmitting },
	} = useForm<ProjectFormValues>({
		resolver: zodResolver(schema),
		defaultValues: initial ?? {
			name: "",
			slug: "",
			description: "",
			workspaceId: "",
			status: "active",
		},
	});
	const pending = busy || isSubmitting;
	const selectedWorkspaceId = watch("workspaceId");
	const unavailableWorkspace =
		Boolean(selectedWorkspaceId) &&
		!workspaces.some(
			(workspace) =>
				workspace.id === selectedWorkspaceId && !workspace.archivedAt,
		);
	return (
		<form
			className="grid gap-5 text-sm"
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
						{errors.name.message}
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
							{errors.slug.message}
						</p>
					)}
				</div>
			)}
			<div className="grid gap-2">
				<label htmlFor={`${id}-description`}>{t("description")}</label>
				<textarea
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
						{errors.description.message}
					</p>
				)}
			</div>
			{initial ? (
				<div className="grid gap-2">
					<label htmlFor={`${id}-status`}>{t("status")}</label>
					<select
						id={`${id}-status`}
						disabled={pending}
						className="min-h-10 rounded-md border border-input bg-background p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						{...register("status")}
					>
						<option value="active">{t("active")}</option>
						<option value="completed">{t("completed")}</option>
						<option value="archived">{t("archived")}</option>
					</select>
				</div>
			) : (
				(workspaces.length > 0 || Boolean(selectedWorkspaceId)) && (
					<div className="grid gap-2">
						<label htmlFor={`${id}-workspace`}>{t("workspace")}</label>
						<select
							id={`${id}-workspace`}
							value={selectedWorkspaceId}
							disabled={pending}
							aria-invalid={Boolean(errors.workspaceId)}
							aria-describedby={
								errors.workspaceId ? `${id}-workspace-error` : undefined
							}
							className="min-h-10 rounded-md border border-input bg-background p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							{...register("workspaceId")}
						>
							<option value="">{t("noWorkspace")}</option>
							{unavailableWorkspace && (
								<option value={selectedWorkspaceId} disabled>
									{t("workspaceUnavailableSelection")}
								</option>
							)}
							{workspaces
								.filter((item) => !item.archivedAt)
								.map((item) => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
						</select>
						{errors.workspaceId && (
							<p
								id={`${id}-workspace-error`}
								role="alert"
								className="text-destructive"
							>
								{errors.workspaceId.message}
							</p>
						)}
					</div>
				)
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
