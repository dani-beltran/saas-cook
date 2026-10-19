"use client";

import { createApiClient } from "@saas-cook/api/client";
import type { ProjectDto } from "@saas-cook/api-contracts";
import {
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	Input,
	ProjectForm,
	type ProjectFormValues,
} from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ResourceActivity } from "../features/platform/activity";
import { ProjectFiles } from "../features/platform/files";
import { DashboardShell } from "./dashboard-shell";
import "./projects-dashboard.css";

type Feedback = { message: string; failed?: boolean; signIn?: boolean };
type Confirmation = { project: ProjectDto };

export function Projects({ organizationId }: { organizationId: string }) {
	const locale = useLocale();
	const t = useTranslations("Projects");
	const [projects, setProjects] = useState<ProjectDto[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [searchDraft, setSearchDraft] = useState("");
	const [includeDeleted, setIncludeDeleted] = useState(false);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [focusProjectAction, setFocusProjectAction] = useState(false);
	const [feedback, setFeedback] = useState<
		Record<string, Feedback | undefined>
	>({});
	const [editor, setEditor] = useState<ProjectDto | "create" | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const requestSequence = useRef(0);
	const lifetime = useRef(0);
	const busyRef = useRef(false);
	const operationKeys = useRef(new Map<string, string>());
	const editorHeading = useRef<HTMLHeadingElement>(null);
	const newProjectButton = useRef<HTMLButtonElement>(null);
	const queryKey = `${organizationId}:${search}:${includeDeleted}`;
	const currentQuery = useRef(queryKey);
	currentQuery.current = queryKey;
	const api = useCallback(
		() => createApiClient(`${window.location.origin}/api/rpc`),
		[],
	);
	const errorFeedback = useCallback(
		(error: unknown): Feedback => {
			const failure = error as { code?: string; message?: string };
			return {
				failed: true,
				signIn: failure.code === "UNAUTHORIZED",
				message: t(
					failure.message === "CAPACITY"
						? "capacity"
						: failure.message === "DISABLED"
							? "projectDisabled"
							: failure.code === "CONFLICT"
								? "conflict"
								: failure.code === "FORBIDDEN" || failure.code === "NOT_FOUND"
									? "permission"
									: failure.code === "UNAUTHORIZED"
										? "reauthenticate"
										: "failed",
				),
			};
		},
		[t],
	);
	const notice = (target: string) => {
		const value = feedback[target];
		return value ? (
			<div
				className={`dashboard-notice projects-feedback${value.failed ? " projects-feedback-error" : ""}`}
				role="status"
				aria-live="polite"
			>
				{value.message}
				{value.signIn && (
					<a
						href={`/${locale}/account#security`}
						target="_blank"
						rel="noreferrer"
						className="projects-feedback-link"
					>
						{t("accountSecurity")}
					</a>
				)}
			</div>
		) : null;
	};
	const load = useCallback(
		async (cursor?: string) => {
			if (currentQuery.current !== queryKey) return;
			const sequence = ++requestSequence.current;
			setLoading(true);
			setFeedback((previous) => ({ ...previous, list: undefined }));
			if (!cursor) {
				setProjects([]);
				setNextCursor(null);
			}
			try {
				const page = await api().projects.list({
					organizationId,
					search,
					includeDeleted,
					limit: 20,
					cursor,
				});
				if (
					sequence !== requestSequence.current ||
					currentQuery.current !== queryKey
				)
					return;
				setProjects((previous) =>
					cursor ? [...previous, ...page.items] : page.items,
				);
				setNextCursor(page.nextCursor);
			} catch (error) {
				if (
					sequence === requestSequence.current &&
					currentQuery.current === queryKey
				) {
					setFeedback((previous) => ({
						...previous,
						list: errorFeedback(error),
					}));
				}
			} finally {
				if (
					sequence === requestSequence.current &&
					currentQuery.current === queryKey
				)
					setLoading(false);
			}
		},
		[api, organizationId, search, includeDeleted, errorFeedback, queryKey],
	);
	useEffect(() => {
		void load();
		return () => {
			requestSequence.current++;
		};
	}, [load]);
	useEffect(
		() => () => {
			lifetime.current++;
		},
		[],
	);
	useEffect(() => {
		if (editor) editorHeading.current?.focus();
	}, [editor]);
	useEffect(() => {
		if (focusProjectAction && !busy) {
			newProjectButton.current?.focus();
			setFocusProjectAction(false);
		}
	}, [focusProjectAction, busy]);
	function operationKey(signature: string) {
		const existing = operationKeys.current.get(signature);
		if (existing) return existing;
		const key = crypto.randomUUID();
		operationKeys.current.set(signature, key);
		return key;
	}
	async function mutate(
		target: string,
		work: () => Promise<unknown>,
		options: {
			signature?: string;
			closeEditor?: boolean;
		} = {},
	) {
		if (busyRef.current) return false;
		const currentLifetime = lifetime.current;
		busyRef.current = true;
		setBusy(true);
		setFeedback((previous) => ({ ...previous, [target]: undefined }));
		try {
			await work();
			if (currentLifetime !== lifetime.current) return false;
			if (options.signature) operationKeys.current.delete(options.signature);
			setFeedback((previous) => ({
				...previous,
				[target === "editor" ? "listAction" : target]: { message: t("saved") },
			}));
			if (options.closeEditor) {
				setEditor(null);
				setFocusProjectAction(true);
			}
			if (target === "confirmation") setFocusProjectAction(true);
			setConfirmation(null);
			await load();
			return true;
		} catch (error) {
			if (currentLifetime === lifetime.current)
				setFeedback((previous) => ({
					...previous,
					[target]: errorFeedback(error),
				}));
			return false;
		} finally {
			if (currentLifetime === lifetime.current) {
				busyRef.current = false;
				setBusy(false);
			}
		}
	}
	async function save(value: ProjectFormValues) {
		const signature = `create:${JSON.stringify(value)}`;
		await mutate(
			"editor",
			() =>
				editor && editor !== "create"
					? api().projects.update({
							organizationId,
							id: editor.id,
							version: editor.version,
							name: value.name,
							description: value.description,
							status: value.status,
						})
					: api().projects.create({
							organizationId,
							name: value.name,
							slug: value.slug,
							description: value.description,
							operationKey: operationKey(signature),
						}),
			{ signature, closeEditor: true },
		);
	}
	function openEditor(value: ProjectDto | "create") {
		if (value === "create" && editor !== "create") {
			for (const signature of operationKeys.current.keys()) {
				if (signature.startsWith("create:"))
					operationKeys.current.delete(signature);
			}
		}
		setFeedback((previous) => ({
			...previous,
			editor: undefined,
			listAction: undefined,
		}));
		setEditor(value);
	}
	function closeEditor() {
		setEditor(null);
		newProjectButton.current?.focus();
	}
	function confirmAction() {
		if (!confirmation) return;
		const project = confirmation.project;
		const signature = `delete:${project.id}:${project.version}`;
		void mutate(
			"confirmation",
			() =>
				api().projects.delete({
					organizationId,
					id: project.id,
					version: project.version,
					operationKey: operationKey(signature),
				}),
			{ signature },
		);
	}
	const updatedDate = (value: string) =>
		new Intl.DateTimeFormat(locale, {
			month: "short",
			day: "numeric",
			year: "numeric",
		}).format(new Date(value));

	return (
		<DashboardShell section="projects" organizationId={organizationId}>
			<header className="dashboard-page-header">
				<div>
					<p className="dashboard-eyebrow">{t("eyebrow")}</p>
					<h1>{t("title")}</h1>
					<p className="dashboard-description">{t("subtitle")}</p>
				</div>
				<Button
					ref={newProjectButton}
					disabled={busy}
					onClick={() => openEditor("create")}
				>
					<span aria-hidden="true">＋</span> {t("newProject")}
				</Button>
			</header>
			{editor && (
				<section
					className="projects-editor"
					aria-label={editor === "create" ? t("newProject") : t("editProject")}
				>
					<div className="projects-editor-heading">
						<div>
							<h2 ref={editorHeading} tabIndex={-1}>
								{editor === "create" ? t("newProject") : t("editProject")}
							</h2>
							<p>{editor === "create" ? t("createHint") : t("editHint")}</p>
						</div>
					</div>
					{notice("editor")}
					{editor !== "create" && (
						<ResourceActivity
							key={editor.id}
							organizationId={organizationId}
							resourceType="project"
							resourceId={editor.id}
						/>
					)}
					{editor !== "create" && (
						<ProjectFiles
							key={editor.id}
							organizationId={organizationId}
							projectId={editor.id}
						/>
					)}
					<ProjectForm
						key={editor === "create" ? "new" : `${editor.id}:${editor.version}`}
						initial={
							editor === "create"
								? undefined
								: {
										name: editor.name,
										slug: editor.slug,
										description: editor.description,
										status: editor.status,
									}
						}
						busy={busy}
						onSave={save}
						onCancel={closeEditor}
					/>
				</section>
			)}
			<section className="projects-section" aria-label={t("title")}>
				<div className="projects-toolbar">
					<form
						className="projects-search"
						onSubmit={(event) => {
							event.preventDefault();
							if (searchDraft.trim() === search) void load();
							else setSearch(searchDraft.trim());
						}}
					>
						<label className="sr-only" htmlFor="project-search">
							{t("search")}
						</label>
						<Input
							id="project-search"
							name="search"
							maxLength={120}
							type="search"
							value={searchDraft}
							placeholder={t("search")}
							onChange={(event) => setSearchDraft(event.target.value)}
						/>
						<Button
							className="dashboard-secondary"
							type="submit"
							disabled={busy}
						>
							{t("searchSubmit")}
						</Button>
					</form>
					<div className="projects-toolbar-options">
						<label
							className="projects-checkbox"
							htmlFor="projects-include-deleted"
						>
							<Checkbox
								id="projects-include-deleted"
								checked={includeDeleted}
								disabled={busy}
								onCheckedChange={(checked) =>
									setIncludeDeleted(checked === true)
								}
							/>
							{t("showDeleted")}
						</label>
						<Button
							className="dashboard-secondary"
							disabled={busy || loading}
							onClick={() => void load()}
						>
							{t("refresh")}
						</Button>
					</div>
				</div>
				{notice("list")}
				{notice("listAction")}
				{loading && (
					<p className="projects-loading" role="status">
						{t("loading")}
					</p>
				)}
				{!loading && !feedback.list && projects.length === 0 && (
					<div className="dashboard-empty projects-empty">
						<h2>{search ? t("noResults") : t("emptyTitle")}</h2>
						<p>{search ? t("empty") : t("emptyHint")}</p>
						{nextCursor && <p>{t("continuationHint")}</p>}
						{search && (
							<Button
								className="dashboard-secondary"
								onClick={() => {
									setSearch("");
									setSearchDraft("");
								}}
							>
								{t("clearSearch")}
							</Button>
						)}
					</div>
				)}
				{projects.length > 0 && (
					<div className="projects-list-heading" aria-hidden="true">
						<span>{t("project")}</span>
						<span>{t("status")}</span>
						<span>{t("updated")}</span>
						<span />
					</div>
				)}
				<ul className="projects-list" aria-busy={loading}>
					{projects.map((project) => (
						<li key={project.id} className="projects-item">
							<div className="projects-item-main">
								<div className="projects-item-identity">
									<span className="projects-item-mark" aria-hidden="true">
										{project.name.charAt(0).toUpperCase()}
									</span>
									<div>
										<h2>{project.name}</h2>
										<p
											className={`projects-item-description${project.description.length > 160 ? " projects-description-preview" : ""}`}
										>
											{project.description || t("noDescription")}
										</p>
										{project.description.length > 160 && (
											<details className="projects-description-disclosure">
												<summary>{t("readDescription")}</summary>
												<p>{project.description}</p>
											</details>
										)}
									</div>
								</div>
								<span
									className={`dashboard-badge projects-status projects-status-${project.deletedAt ? "deleted" : project.status}`}
								>
									<span aria-hidden="true" />
									{project.deletedAt ? t("deleted") : t(project.status)}
								</span>
								<time className="projects-updated" dateTime={project.updatedAt}>
									{updatedDate(project.updatedAt)}
								</time>
								<div className="projects-item-actions">
									{project.deletedAt ? (
										<Button
											className="dashboard-secondary"
											disabled={busy}
											onClick={() => {
												const signature = `restore:${project.id}:${project.version}`;
												void mutate(
													project.id,
													() =>
														api().projects.restore({
															organizationId,
															id: project.id,
															version: project.version,
															operationKey: operationKey(signature),
														}),
													{ signature },
												);
											}}
										>
											{t("restore")}
										</Button>
									) : (
										<Button
											className="dashboard-secondary"
											disabled={busy}
											onClick={() => openEditor(project)}
										>
											{t("edit")}
										</Button>
									)}
								</div>
							</div>
							{!project.deletedAt && (
								<details className="projects-context">
									<summary>
										{t("projectActions", { name: project.name })}
									</summary>
									<div className="projects-context-content">
										<Button
											className="dashboard-danger"
											disabled={busy}
											onClick={() => {
												setFeedback((previous) => ({
													...previous,
													confirmation: undefined,
												}));
												setConfirmation({ project });
											}}
										>
											{t("delete")}
										</Button>
									</div>
								</details>
							)}
							{notice(project.id)}
						</li>
					))}
				</ul>
				{nextCursor && (
					<div className="projects-pagination">
						<Button
							className="dashboard-secondary"
							disabled={busy || loading}
							onClick={() => void load(nextCursor)}
						>
							{t("next")}
						</Button>
						<p>{t("paginationHint")}</p>
					</div>
				)}
			</section>
			<Dialog
				open={Boolean(confirmation)}
				onOpenChange={(open) => {
					if (!open && !busyRef.current) setConfirmation(null);
				}}
			>
				<DialogContent
					className="projects-confirmation"
					showCloseButton={false}
					onInteractOutside={(event) => event.preventDefault()}
					onEscapeKeyDown={(event) => {
						if (busyRef.current) event.preventDefault();
					}}
				>
					{confirmation && (
						<>
							<DialogTitle>
								{t("deleteTitle", { name: confirmation.project.name })}
							</DialogTitle>
							<DialogDescription>{t("deleteHint")}</DialogDescription>
							{notice("confirmation")}
							<div className="projects-confirmation-actions">
								<Button
									className="dashboard-secondary"
									disabled={busy}
									onClick={() => setConfirmation(null)}
								>
									{t("cancel")}
								</Button>
								<Button
									className="dashboard-danger"
									disabled={busy}
									onClick={confirmAction}
								>
									{busy ? t("saving") : t("confirmDelete")}
								</Button>
							</div>
						</>
					)}
				</DialogContent>
			</Dialog>
		</DashboardShell>
	);
}
