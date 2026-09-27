"use client";

import { createApiClient } from "@common-saas/api/client";
import type { ProjectDto, WorkspaceDto } from "@common-saas/api-contracts";
import {
	Button,
	Input,
	ProjectForm,
	type ProjectFormValues,
} from "@common-saas/ui";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardShell } from "./dashboard-shell";
import "./projects-dashboard.css";

type Feedback = { message: string; failed?: boolean; signIn?: boolean };
type Confirmation =
	| { kind: "delete"; project: ProjectDto }
	| { kind: "archive"; workspace: WorkspaceDto };

export function Projects({ organizationId }: { organizationId: string }) {
	const locale = useLocale();
	const t = useTranslations("Projects");
	const [projects, setProjects] = useState<ProjectDto[]>([]);
	const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [workspaceCursor, setWorkspaceCursor] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [searchDraft, setSearchDraft] = useState("");
	const [includeDeleted, setIncludeDeleted] = useState(false);
	const [loading, setLoading] = useState(true);
	const [workspaceLoading, setWorkspaceLoading] = useState(true);
	const [workspaceUnavailable, setWorkspaceUnavailable] = useState(false);
	const [busy, setBusy] = useState(false);
	const [focusProjectAction, setFocusProjectAction] = useState(false);
	const [feedback, setFeedback] = useState<
		Record<string, Feedback | undefined>
	>({});
	const [editor, setEditor] = useState<ProjectDto | "create" | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const requestSequence = useRef(0);
	const workspaceSequence = useRef(0);
	const lifetime = useRef(0);
	const busyRef = useRef(false);
	const operationKeys = useRef(new Map<string, string>());
	const editorHeading = useRef<HTMLHeadingElement>(null);
	const confirmationDialog = useRef<HTMLDialogElement>(null);
	const newProjectButton = useRef<HTMLButtonElement>(null);
	const queryKey = `${organizationId}:${search}:${includeDeleted}`;
	const currentQuery = useRef(queryKey);
	currentQuery.current = queryKey;
	const api = useCallback(
		() => createApiClient(`${window.location.origin}/api/rpc`),
		[],
	);
	const errorFeedback = useCallback(
		(error: unknown, workspace = false): Feedback => {
			const failure = error as { code?: string; message?: string };
			return {
				failed: true,
				signIn: failure.code === "UNAUTHORIZED",
				message: t(
					failure.message === "CAPACITY"
						? "capacity"
						: failure.message === "DISABLED"
							? workspace
								? "workspaceDisabled"
								: "projectDisabled"
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
	const loadWorkspaces = useCallback(
		async (cursor?: string) => {
			const sequence = ++workspaceSequence.current;
			setWorkspaceLoading(true);
			try {
				const page = await api().workspaces.list({
					organizationId,
					limit: 50,
					cursor,
				});
				if (sequence !== workspaceSequence.current) return;
				setWorkspaces((previous) =>
					cursor ? [...previous, ...page.items] : page.items,
				);
				setWorkspaceCursor(page.nextCursor);
				setWorkspaceUnavailable(false);
				setFeedback((previous) => ({ ...previous, workspaceList: undefined }));
			} catch (error) {
				if (sequence !== workspaceSequence.current) return;
				if (!cursor) {
					setWorkspaces([]);
					setWorkspaceCursor(null);
					setWorkspaceUnavailable(true);
				}
				setFeedback((previous) => ({
					...previous,
					workspaceList: errorFeedback(error, true),
				}));
			} finally {
				if (sequence === workspaceSequence.current) setWorkspaceLoading(false);
			}
		},
		[api, organizationId, errorFeedback],
	);
	useEffect(() => {
		void load();
		return () => {
			requestSequence.current++;
		};
	}, [load]);
	useEffect(() => {
		void loadWorkspaces();
		return () => {
			workspaceSequence.current++;
		};
	}, [loadWorkspaces]);
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
	useEffect(() => {
		if (confirmation) confirmationDialog.current?.showModal();
		else confirmationDialog.current?.close();
	}, [confirmation]);
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
			workspace?: boolean;
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
			if (target === "confirmation" && !options.workspace)
				setFocusProjectAction(true);
			setConfirmation(null);
			await (options.workspace ? loadWorkspaces() : load());
			return true;
		} catch (error) {
			if (currentLifetime === lifetime.current)
				setFeedback((previous) => ({
					...previous,
					[target]: errorFeedback(error, options.workspace),
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
							workspaceId: value.workspaceId || null,
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
		if (confirmation.kind === "delete") {
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
		} else {
			const workspace = confirmation.workspace;
			void mutate(
				"confirmation",
				() =>
					api().workspaces.update({
						organizationId,
						id: workspace.id,
						version: workspace.version,
						archived: true,
					}),
				{ workspace: true },
			);
		}
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
										workspaceId: editor.workspaceId ?? "",
									}
						}
						workspaces={workspaceUnavailable ? [] : workspaces}
						busy={busy}
						onSave={save}
						onCancel={closeEditor}
					/>
					{editor === "create" && workspaceCursor && (
						<Button
							className="dashboard-secondary"
							disabled={workspaceLoading || busy}
							onClick={() => void loadWorkspaces(workspaceCursor)}
						>
							{t("workspaceMore")}
						</Button>
					)}
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
						<label className="projects-checkbox">
							<input
								type="checkbox"
								checked={includeDeleted}
								disabled={busy}
								onChange={(event) => setIncludeDeleted(event.target.checked)}
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
										<p className="projects-workspace-name">
											{project.workspaceId
												? (workspaces.find(
														(workspace) => workspace.id === project.workspaceId,
													)?.name ?? t("assignedWorkspace"))
												: t("noWorkspace")}
										</p>
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
										{!workspaceUnavailable && (
											<form
												className="projects-move-form"
												onSubmit={(event) => {
													event.preventDefault();
													const data = new FormData(event.currentTarget);
													void mutate(project.id, () =>
														api().projects.move({
															organizationId,
															id: project.id,
															version: project.version,
															workspaceId:
																String(data.get("workspaceId") ?? "") || null,
														}),
													);
												}}
											>
												<div className="dashboard-field">
													<label htmlFor={`move-${project.id}`}>
														{t("moveDestination", { name: project.name })}
													</label>
													<select
														key={`${project.workspaceId}:${project.version}`}
														id={`move-${project.id}`}
														name="workspaceId"
														defaultValue={project.workspaceId ?? ""}
														disabled={busy || workspaceLoading}
													>
														<option value="">{t("noWorkspace")}</option>
														{project.workspaceId &&
															!workspaces.some(
																(workspace) =>
																	workspace.id === project.workspaceId,
															) && (
																<option value={project.workspaceId} disabled>
																	{t("assignedWorkspace")}
																</option>
															)}
														{workspaces
															.filter(
																(workspace) =>
																	!workspace.archivedAt ||
																	workspace.id === project.workspaceId,
															)
															.map((workspace) => (
																<option
																	key={workspace.id}
																	value={workspace.id}
																	disabled={Boolean(workspace.archivedAt)}
																>
																	{workspace.name}
																	{workspace.archivedAt
																		? ` (${t("archived")})`
																		: ""}
																</option>
															))}
													</select>
												</div>
												<Button
													className="dashboard-secondary"
													type="submit"
													disabled={busy || workspaceLoading}
												>
													{t("move")}
												</Button>
												{workspaceCursor && (
													<Button
														className="dashboard-secondary"
														disabled={workspaceLoading || busy}
														onClick={() => void loadWorkspaces(workspaceCursor)}
													>
														{t("workspaceMore")}
													</Button>
												)}
											</form>
										)}
										<Button
											className="dashboard-danger"
											disabled={busy}
											onClick={() => {
												setFeedback((previous) => ({
													...previous,
													confirmation: undefined,
												}));
												setConfirmation({ kind: "delete", project });
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
			<section
				className="dashboard-section projects-workspaces"
				aria-labelledby="workspaces-title"
			>
				<div className="dashboard-section-heading projects-workspace-heading">
					<div>
						<h2 id="workspaces-title">{t("workspaces")}</h2>
						<p>{t("workspaceHint")}</p>
					</div>
					<Button
						className="dashboard-secondary"
						disabled={busy || workspaceLoading}
						onClick={() => void loadWorkspaces()}
					>
						{t("workspaceRefresh")}
					</Button>
				</div>
				{notice("workspaceList")}
				{notice("workspaceCreate")}
				{workspaceLoading && (
					<p role="status" className="projects-loading">
						{t("workspaceLoading")}
					</p>
				)}
				{!workspaceUnavailable && (
					<>
						<details className="projects-workspace-create">
							<summary>{t("workspaceCreate")}</summary>
							<form
								className="projects-workspace-form"
								onSubmit={async (event) => {
									event.preventDefault();
									const form = event.currentTarget;
									const data = new FormData(form);
									const name = String(data.get("name")).trim();
									const slug = String(data.get("slug"));
									const signature = `workspace:${name}:${slug}`;
									if (
										await mutate(
											"workspaceCreate",
											() =>
												api().workspaces.create({
													organizationId,
													name,
													slug,
													operationKey: operationKey(signature),
												}),
											{ workspace: true, signature },
										)
									)
										form.reset();
								}}
							>
								<div className="dashboard-field">
									<label htmlFor="workspace-name">{t("name")}</label>
									<Input
										id="workspace-name"
										name="name"
										minLength={2}
										maxLength={80}
										required
										disabled={busy}
									/>
								</div>
								<div className="dashboard-field">
									<label htmlFor="workspace-slug">{t("slug")}</label>
									<Input
										id="workspace-slug"
										name="slug"
										pattern="[a-z0-9][a-z0-9-]{1,62}"
										aria-describedby="workspace-slug-hint"
										required
										disabled={busy}
									/>
								</div>
								<Button type="submit" disabled={busy}>
									{t("workspaceCreate")}
								</Button>
								<p
									id="workspace-slug-hint"
									className="projects-workspace-slug-hint"
								>
									{t("slugHint")}
								</p>
							</form>
						</details>
						{!workspaceLoading && !workspaces.length && (
							<p className="projects-workspace-empty">{t("workspaceEmpty")}</p>
						)}
						<ul className="projects-workspace-list">
							{workspaces.map((workspace) => (
								<li key={workspace.id} className="projects-workspace-item">
									<div className="projects-workspace-row">
										<div>
											<h3>{workspace.name}</h3>
											<p>
												{workspace.archivedAt
													? t("workspaceArchived")
													: t("workspaceActive")}
											</p>
										</div>
										<span className="dashboard-badge">
											{workspace.archivedAt ? t("archived") : t("active")}
										</span>
										<Button
											className="dashboard-secondary"
											disabled={busy}
											onClick={() => {
												if (workspace.archivedAt)
													void mutate(
														workspace.id,
														() =>
															api().workspaces.update({
																organizationId,
																id: workspace.id,
																version: workspace.version,
																archived: false,
															}),
														{ workspace: true },
													);
												else {
													setFeedback((previous) => ({
														...previous,
														confirmation: undefined,
													}));
													setConfirmation({ kind: "archive", workspace });
												}
											}}
										>
											{workspace.archivedAt
												? t("workspaceRestore")
												: t("workspaceArchive")}
										</Button>
									</div>
									<details className="projects-context">
										<summary>
											{t("renameWorkspace", { name: workspace.name })}
										</summary>
										<form
											className="projects-workspace-rename"
											onSubmit={(event) => {
												event.preventDefault();
												const data = new FormData(event.currentTarget);
												void mutate(
													workspace.id,
													() =>
														api().workspaces.update({
															organizationId,
															id: workspace.id,
															version: workspace.version,
															name: String(data.get("name")).trim(),
														}),
													{ workspace: true },
												);
											}}
										>
											<div className="dashboard-field">
												<label htmlFor={`rename-${workspace.id}`}>
													{t("name")}
												</label>
												<Input
													key={`${workspace.id}:${workspace.version}`}
													id={`rename-${workspace.id}`}
													name="name"
													defaultValue={workspace.name}
													minLength={2}
													maxLength={80}
													required
													disabled={busy}
												/>
											</div>
											<Button
												className="dashboard-secondary"
												type="submit"
												disabled={busy}
											>
												{t("workspaceRename")}
											</Button>
										</form>
									</details>
									{notice(workspace.id)}
								</li>
							))}
						</ul>
						{workspaceCursor && (
							<Button
								className="dashboard-secondary"
								disabled={busy || workspaceLoading}
								onClick={() => void loadWorkspaces(workspaceCursor)}
							>
								{t("workspaceMore")}
							</Button>
						)}
					</>
				)}
			</section>
			<dialog
				ref={confirmationDialog}
				className="projects-confirmation"
				aria-labelledby="project-confirm-title"
				aria-describedby="project-confirm-description"
				onCancel={(event) => {
					if (busy) event.preventDefault();
					else setConfirmation(null);
				}}
			>
				{confirmation && (
					<>
						<h2 id="project-confirm-title">
							{confirmation.kind === "delete"
								? t("deleteTitle", { name: confirmation.project.name })
								: t("archiveTitle", { name: confirmation.workspace.name })}
						</h2>
						<p id="project-confirm-description">
							{confirmation.kind === "delete"
								? t("deleteHint")
								: t("workspaceArchived")}
						</p>
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
								{busy
									? t("saving")
									: confirmation.kind === "delete"
										? t("confirmDelete")
										: t("confirmArchive")}
							</Button>
						</div>
					</>
				)}
			</dialog>
		</DashboardShell>
	);
}
