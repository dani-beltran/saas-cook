"use client";
import { Button, Input, NativeSelect, NativeSelectOption } from "@saas-cook/ui";
import { useEffect, useState } from "react";
import { DashboardShell } from "../../components/dashboard-shell";
import { api, download, Reload, Status, useOperation } from "./common";

type Jobs = Awaited<
	ReturnType<ReturnType<typeof api>["completion"]["bulkList"]>
>;
export function DataPage({ organizationId }: { organizationId: string }) {
	const op = useOperation(),
		{ es } = op;
	const [jobs, setJobs] = useState<Jobs>(),
		[projects, setProjects] = useState<{ id: string; name: string }[]>([]),
		[project, setProject] = useState(""),
		[files, setFiles] = useState<{ id: string; name: string }[]>([]),
		[file, setFile] = useState(""),
		[dry, setDry] = useState<{ row: number; errors: string[] }[]>(),
		[loaded, setLoaded] = useState(false);
	const load = async () => {
		setJobs(await api().completion.bulkList({ organizationId }));
		setLoaded(true);
	};
	useEffect(() => {
		let live = true;
		const poll = () =>
			api()
				.completion.bulkList({ organizationId })
				.then((r) => {
					if (live) {
						setJobs(r);
						setLoaded(true);
					}
				})
				.catch(() => {
					if (live) setLoaded(true);
				});
		void poll();
		void api()
			.projects.list({ organizationId, limit: 50 })
			.then((r) => {
				if (live) setProjects(r.items);
			})
			.catch(() => {});
		const timer = setInterval(() => void poll(), 5000);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [organizationId]);
	useEffect(() => {
		let live = true;
		setFiles([]);
		setFile("");
		if (project)
			void api()
				.files.list({ organizationId, projectId: project })
				.then((r) => {
					if (live) setFiles(r.filter((f) => f.state === "available"));
				})
				.catch(() => {});
		return () => {
			live = false;
		};
	}, [organizationId, project]);
	return (
		<DashboardShell section="data" organizationId={organizationId}>
			<header className="dashboard-page-header">
				<h1>{es ? "Datos de la organización" : "Organization data"}</h1>
				<Reload load={() => void op.run(load)} disabled={op.busy} />
			</header>
			<p>
				{es
					? "Los archivos de exportación caducan a las 24 horas. Los trabajos verifican tus permisos actuales en cada paso."
					: "Exports expire after 24 hours. Jobs check your current access at each step."}
			</p>
			<Status {...op} />
			<section className="completion-card">
				<h2>{es ? "Exportar" : "Export"}</h2>
				<div className="completion-actions">
					{(
						["projects.export", "organization.export", "audit.export"] as const
					).map((kind, index) => (
						<Button
							disabled={op.busy}
							key={kind}
							onClick={() =>
								void op.run(async () => {
									await api().completion.bulkStart({
										organizationId,
										kind,
										operationKey: crypto.randomUUID(),
									});
									await load();
								})
							}
						>
							{
								(es
									? [
											"Proyectos CSV",
											"Organización JSON",
											"Registro de auditoría JSON",
										]
									: ["Projects CSV", "Organization JSON", "Audit log JSON"])[
									index
								]
							}
						</Button>
					))}
				</div>
				<p>
					{es
						? "La auditoría necesita un permiso adicional del propietario."
						: "Audit exports require an additional owner-granted permission."}
				</p>
			</section>
			<section className="completion-card">
				<h2>{es ? "Importar proyectos" : "Import projects"}</h2>
				<p>
					{es
						? "Sube primero un CSV en los archivos de un proyecto. Máximo 1000 filas y 1 MiB."
						: "First upload a CSV in a project’s files. Maximum 1,000 rows and 1 MiB."}
				</p>
				<a href={`../${organizationId}/projects`}>
					{es ? "Abrir proyectos y archivos" : "Open projects and files"}
				</a>
				<form
					className="completion-form"
					onSubmit={(e) => {
						e.preventDefault();
						const f = new FormData(e.currentTarget),
							submitter = (e.nativeEvent as SubmitEvent)
								.submitter as HTMLButtonElement;
						const input = {
							organizationId,
							kind: "projects.import" as const,
							projectId: project,
							fileId: file,
							mapping: {
								name: String(f.get("name")),
								slug: String(f.get("slug")),
								...(f.get("description")
									? { description: String(f.get("description")) }
									: {}),
							},
							duplicates:
								f.get("duplicates") === "skip"
									? ("skip" as const)
									: ("reject" as const),
							operationKey: crypto.randomUUID(),
						};
						void op.run(async () => {
							if (submitter.value === "check")
								setDry(await api().completion.bulkDryRun(input));
							else {
								await api().completion.bulkStart(input);
								setDry(undefined);
								await load();
							}
						});
					}}
				>
					<label htmlFor="data-field-1">
						{es ? "Proyecto de origen" : "Source project"}
						<NativeSelect
							id="data-field-1"
							value={project}
							onChange={(e) => {
								setProject(e.target.value);
								setDry(undefined);
							}}
							required
						>
							<NativeSelectOption value="">
								{es ? "Seleccionar" : "Select"}
							</NativeSelectOption>
							{projects.map((p) => (
								<NativeSelectOption key={p.id} value={p.id}>
									{p.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</label>
					<label htmlFor="data-field-2">
						{es ? "Archivo CSV verificado" : "Verified CSV file"}
						<NativeSelect
							id="data-field-2"
							value={file}
							onChange={(e) => {
								setFile(e.target.value);
								setDry(undefined);
							}}
							required
						>
							<NativeSelectOption value="">
								{es ? "Seleccionar" : "Select"}
							</NativeSelectOption>
							{files.map((f) => (
								<NativeSelectOption key={f.id} value={f.id}>
									{f.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</label>
					<label htmlFor="data-field-3">
						{es ? "Columna del nombre" : "Name column"}
						<Input
							id="data-field-3"
							name="name"
							defaultValue="name"
							required
							maxLength={100}
						/>
					</label>
					<label htmlFor="data-field-4">
						{es ? "Columna del identificador" : "Slug column"}
						<Input
							id="data-field-4"
							name="slug"
							defaultValue="slug"
							required
							maxLength={100}
						/>
					</label>
					<label htmlFor="data-field-5">
						{es
							? "Columna de descripción (opcional)"
							: "Description column (optional)"}
						<Input id="data-field-5" name="description" maxLength={100} />
					</label>
					<label htmlFor="data-field-6">
						{es ? "Duplicados" : "Duplicates"}
						<NativeSelect id="data-field-6" name="duplicates">
							<NativeSelectOption value="reject">
								{es ? "Rechazar" : "Reject"}
							</NativeSelectOption>
							<NativeSelectOption value="skip">
								{es ? "Omitir" : "Skip"}
							</NativeSelectOption>
						</NativeSelect>
					</label>
					<div className="completion-actions">
						<Button
							type="submit"
							name="action"
							value="check"
							disabled={op.busy}
						>
							{es ? "Validar sin importar" : "Dry run"}
						</Button>
						<Button
							type="submit"
							name="action"
							value="start"
							disabled={op.busy}
						>
							{es ? "Iniciar importación" : "Start import"}
						</Button>
					</div>
				</form>
				{dry && (
					<div role="status">
						<p>
							{dry.length} {es ? "filas revisadas" : "rows checked"}
						</p>
						<ul>
							{dry
								.filter((r) => r.errors.length)
								.map((r) => (
									<li key={r.row}>
										{es ? "Fila" : "Row"} {r.row}: {r.errors.join(", ")}
									</li>
								))}
						</ul>
					</div>
				)}
			</section>
			<section className="completion-card">
				<h2>{es ? "Tus trabajos" : "Your jobs"}</h2>
				{!loaded ? (
					<p>{es ? "Cargando…" : "Loading…"}</p>
				) : !jobs ? (
					<p role="alert">
						{es
							? "No se pudieron cargar los trabajos."
							: "Jobs could not be loaded."}
					</p>
				) : jobs.length === 0 ? (
					<p>{es ? "No hay trabajos." : "No jobs yet."}</p>
				) : (
					<ul className="completion-list">
						{jobs.map((j) => (
							<li key={j.id}>
								<strong>{j.kind}</strong>
								<p>
									{j.state} · {j.progress}/{j.total}
								</p>
								{j.errors.map((e) => (
									<p key={`${e.row}-${e.code}`}>
										{e.row}: {e.code}
									</p>
								))}
								<div className="completion-actions">
									{j.state === "complete" && j.kind !== "projects.import" && (
										<Button
											disabled={op.busy}
											onClick={() =>
												void op.run(async () =>
													download(
														await api().completion.bulkDownload({
															organizationId,
															id: j.id,
														}),
													),
												)
											}
										>
											{es ? "Descargar" : "Download"}
										</Button>
									)}
									{j.state === "failed" && (
										<Button
											disabled={op.busy}
											onClick={() =>
												void op.run(async () => {
													await api().completion.bulkResume({
														organizationId,
														id: j.id,
													});
													await load();
												})
											}
										>
											{es
												? "Reintentar con acceso actual"
												: "Retry with current access"}
										</Button>
									)}
									{["pending", "running", "failed"].includes(j.state) && (
										<Button
											variant="secondary"
											disabled={op.busy}
											onClick={() =>
												void op.run(async () => {
													await api().completion.bulkCancel({
														organizationId,
														id: j.id,
													});
													await load();
												})
											}
										>
											{es ? "Cancelar" : "Cancel"}
										</Button>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
			</section>
		</DashboardShell>
	);
}
