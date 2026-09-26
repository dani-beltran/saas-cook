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

export function Projects({ organizationId }: { organizationId: string }) {
	const locale = useLocale();
	const t = useTranslations("Projects");
	const [projects, setProjects] = useState<ProjectDto[]>([]);
	const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [workspaceCursor, setWorkspaceCursor] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [includeDeleted, setIncludeDeleted] = useState(false);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [workspaceMessage, setWorkspaceMessage] = useState("");
	const [editor, setEditor] = useState<ProjectDto | "create" | null>(null);
	const [theme, setTheme] = useState<"light" | "dark">("light");
	const requestSequence = useRef(0);
	const api = useCallback(
		() => createApiClient(`${window.location.origin}/api/rpc`),
		[],
	);
	const errorMessage = useCallback(
		(error: unknown) => {
			const failure = error as { code?: string; message?: string };
			return t(
				failure.message === "CAPACITY"
					? "capacity"
					: failure.message === "DISABLED"
						? "workspaceDisabled"
						: failure.code === "CONFLICT"
							? "conflict"
							: failure.code === "FORBIDDEN" || failure.code === "NOT_FOUND"
								? "permission"
								: failure.code === "UNAUTHORIZED"
									? "reauthenticate"
									: "failed",
			);
		},
		[t],
	);
	const load = useCallback(
		async (cursor?: string) => {
			const sequence = ++requestSequence.current;
			setLoading(true);
			try {
				const page = await api().projects.list({
					organizationId,
					search,
					includeDeleted,
					limit: 20,
					cursor,
				});
				if (sequence !== requestSequence.current) return;
				setProjects((previous) =>
					cursor ? [...previous, ...page.items] : page.items,
				);
				setNextCursor(page.nextCursor);
			} catch (error) {
				if (sequence === requestSequence.current) {
					setMessage(errorMessage(error));
					if (!cursor) {
						setProjects([]);
						setNextCursor(null);
					}
				}
			} finally {
				if (sequence === requestSequence.current) setLoading(false);
			}
		},
		[api, organizationId, search, includeDeleted, errorMessage],
	);
	const loadWorkspaces = useCallback(
		async (cursor?: string) => {
			try {
				const page = await api().workspaces.list({
					organizationId,
					limit: 50,
					cursor,
				});
				setWorkspaces((previous) =>
					cursor ? [...previous, ...page.items] : page.items,
				);
				setWorkspaceCursor(page.nextCursor);
				setWorkspaceMessage("");
			} catch (error) {
				setWorkspaceMessage(errorMessage(error));
			}
		},
		[api, organizationId, errorMessage],
	);
	useEffect(() => {
		void load();
		return () => {
			requestSequence.current++;
		};
	}, [load]);
	useEffect(() => {
		void loadWorkspaces();
	}, [loadWorkspaces]);
	async function mutate(work: () => Promise<unknown>) {
		setBusy(true);
		setMessage("");
		try {
			await work();
			setMessage(t("saved"));
			setEditor(null);
			await Promise.all([load(), loadWorkspaces()]);
		} catch (error) {
			setMessage(errorMessage(error));
		} finally {
			setBusy(false);
		}
	}
	async function save(value: ProjectFormValues) {
		await mutate(() =>
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
						operationKey: crypto.randomUUID(),
					}),
		);
	}
	return (
		<div
			className={`${theme === "dark" ? "dark" : ""} min-h-screen bg-background text-foreground`}
		>
			<main className="mx-auto max-w-6xl space-y-8 p-6 sm:p-12">
				<header className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<a
							className="text-sm underline"
							href={`/${locale}/organizations/${organizationId}`}
						>
							{t("back")}
						</a>
						<h1 className="mt-4 text-3xl font-semibold">{t("title")}</h1>
						<p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
					</div>
					<div className="flex items-center gap-3">
						<select
							className="min-h-10 rounded border border-input bg-background p-2"
							aria-label={t("language")}
							value={locale}
							onChange={(event) =>
								window.location.assign(
									`/${event.target.value}/organizations/${organizationId}/projects`,
								)
							}
						>
							<option value="en">English</option>
							<option value="es">Español</option>
						</select>
						<Button
							aria-label={t("theme")}
							aria-pressed={theme === "dark"}
							onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
						>
							{theme === "dark" ? t("light") : t("dark")}
						</Button>
					</div>
				</header>
				<p role="status" aria-live="polite">
					{message}
				</p>
				<section
					className="space-y-5 rounded-xl border border-border bg-card p-6"
					aria-label={t("title")}
				>
					<div className="flex flex-wrap items-end justify-between gap-4">
						<form
							className="flex flex-wrap items-end gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								setMessage("");
								const data = new FormData(event.currentTarget);
								setSearch(String(data.get("search") ?? ""));
							}}
						>
							<div className="grid gap-2">
								<label htmlFor="project-search">{t("search")}</label>
								<Input
									id="project-search"
									name="search"
									maxLength={120}
									type="search"
								/>
							</div>
							<Button type="submit" disabled={busy}>
								{t("searchSubmit")}
							</Button>
							<label className="flex min-h-10 items-center gap-2">
								<input
									type="checkbox"
									checked={includeDeleted}
									onChange={(event) => setIncludeDeleted(event.target.checked)}
								/>
								{t("showDeleted")}
							</label>
						</form>
						<div className="flex gap-3">
							<Button
								disabled={busy || loading}
								onClick={() => {
									setMessage("");
									void load();
								}}
							>
								{t("refresh")}
							</Button>
							<Button disabled={busy} onClick={() => setEditor("create")}>
								{t("newProject")}
							</Button>
						</div>
					</div>
					{editor && (
						<section
							className="max-w-xl space-y-5 rounded-lg border border-border p-5"
							aria-label={
								editor === "create" ? t("newProject") : t("editProject")
							}
						>
							<h2 className="text-xl font-semibold">
								{editor === "create" ? t("newProject") : t("editProject")}
							</h2>
							<ProjectForm
								key={
									editor === "create" ? "new" : `${editor.id}:${editor.version}`
								}
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
								workspaces={workspaces}
								busy={busy}
								onSave={save}
								onCancel={() => setEditor(null)}
							/>
						</section>
					)}
					{loading && <p role="status">{t("loading")}</p>}
					{!loading && projects.length === 0 && <p>{t("empty")}</p>}
					<ul className="space-y-4" aria-busy={loading}>
						{projects.map((project) => (
							<li
								key={project.id}
								className="space-y-4 rounded-lg border border-border p-5"
							>
								<div className="flex flex-wrap justify-between gap-3">
									<div>
										<h2 className="text-lg font-semibold">{project.name}</h2>
										<p className="mt-1 text-sm text-muted-foreground">
											{project.deletedAt ? t("deleted") : t(project.status)} ·{" "}
											{t("version")} {project.version}
										</p>
										<p className="mt-3 whitespace-pre-wrap break-words">
											{project.description}
										</p>
									</div>
									<div className="flex flex-wrap items-start gap-2">
										{project.deletedAt ? (
											<Button
												disabled={busy}
												onClick={() =>
													void mutate(() =>
														api().projects.restore({
															organizationId,
															id: project.id,
															version: project.version,
															operationKey: crypto.randomUUID(),
														}),
													)
												}
											>
												{t("restore")}
											</Button>
										) : (
											<>
												<Button
													disabled={busy}
													onClick={() => setEditor(project)}
												>
													{t("edit")}
												</Button>
												<Button
													disabled={busy}
													onClick={() =>
														void mutate(() =>
															api().projects.delete({
																organizationId,
																id: project.id,
																version: project.version,
																operationKey: crypto.randomUUID(),
															}),
														)
													}
												>
													{t("delete")}
												</Button>
											</>
										)}
									</div>
								</div>
								{!project.deletedAt && !workspaceMessage && (
									<form
										className="flex flex-wrap items-end gap-3"
										onSubmit={(event) => {
											event.preventDefault();
											const data = new FormData(event.currentTarget);
											void mutate(() =>
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
										<div className="grid gap-2">
											<label htmlFor={`move-${project.id}`}>
												{t("moveDestination", { name: project.name })}
											</label>
											<select
												key={`${project.workspaceId}:${project.version}`}
												id={`move-${project.id}`}
												name="workspaceId"
												defaultValue={project.workspaceId ?? ""}
												disabled={busy}
												className="min-h-10 rounded border border-input bg-background p-2"
											>
												<option value="">{t("noWorkspace")}</option>
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
										<Button type="submit" disabled={busy}>
											{t("move")}
										</Button>
									</form>
								)}
							</li>
						))}
					</ul>
					{nextCursor && (
						<Button
							disabled={busy || loading}
							onClick={() => void load(nextCursor)}
						>
							{t("next")}
						</Button>
					)}
				</section>
				<section
					className="space-y-5 rounded-xl border border-border bg-card p-6"
					aria-labelledby="workspaces-title"
				>
					<h2 id="workspaces-title" className="text-xl font-semibold">
						{t("workspaces")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t("workspaceArchived")}
					</p>
					{workspaceMessage ? (
						<p role="status">{workspaceMessage}</p>
					) : (
						<>
							<form
								className="flex flex-wrap items-end gap-3"
								onSubmit={(event) => {
									event.preventDefault();
									const data = new FormData(event.currentTarget);
									void mutate(() =>
										api().workspaces.create({
											organizationId,
											name: String(data.get("name")),
											slug: String(data.get("slug")),
											operationKey: crypto.randomUUID(),
										}),
									);
								}}
							>
								<div className="grid gap-2">
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
								<div className="grid gap-2">
									<label htmlFor="workspace-slug">{t("slug")}</label>
									<Input
										id="workspace-slug"
										name="slug"
										pattern="[a-z0-9][a-z0-9-]{1,62}"
										required
										disabled={busy}
									/>
								</div>
								<Button type="submit" disabled={busy}>
									{t("workspaceCreate")}
								</Button>
							</form>
							<ul className="space-y-3">
								{workspaces.map((workspace) => (
									<li
										key={workspace.id}
										className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-3"
									>
										<form
											className="flex flex-wrap items-center gap-3"
											onSubmit={(event) => {
												event.preventDefault();
												const data = new FormData(event.currentTarget);
												void mutate(() =>
													api().workspaces.update({
														organizationId,
														id: workspace.id,
														version: workspace.version,
														name: String(data.get("name")),
													}),
												);
											}}
										>
											<Input
												key={`${workspace.id}:${workspace.version}`}
												name="name"
												aria-label={`${t("name")} ${workspace.name}`}
												defaultValue={workspace.name}
												minLength={2}
												maxLength={80}
												required
												disabled={busy}
											/>
											<Button type="submit" disabled={busy}>
												{t("workspaceRename")}
											</Button>
										</form>
										<span>
											{workspace.archivedAt ? t("archived") : t("active")}
										</span>
										<Button
											disabled={busy}
											onClick={() =>
												void mutate(() =>
													api().workspaces.update({
														organizationId,
														id: workspace.id,
														version: workspace.version,
														archived: !workspace.archivedAt,
													}),
												)
											}
										>
											{workspace.archivedAt
												? t("workspaceRestore")
												: t("workspaceArchive")}
										</Button>
									</li>
								))}
							</ul>
							{workspaceCursor && (
								<Button
									disabled={busy}
									onClick={() => void loadWorkspaces(workspaceCursor)}
								>
									{t("workspaceMore")}
								</Button>
							)}
						</>
					)}
				</section>
			</main>
		</div>
	);
}
