"use client";
import { createApiClient } from "@saas-cook/api/client";
import { fileMetadata } from "@saas-cook/api-contracts/files";
import { Button, Input } from "@saas-cook/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

type Rows = Awaited<
	ReturnType<ReturnType<typeof createApiClient>["files"]["list"]>
>;
export function ProjectFiles({
	organizationId,
	projectId,
}: {
	organizationId: string;
	projectId: string;
}) {
	const t = useTranslations("ProjectFiles");
	const [rows, setRows] = useState<Rows>(),
		[file, setFile] = useState<File>(),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<string>(),
		[revision, setRevision] = useState(0);
	const current = useRef(true),
		operation = useRef<string>("");
	useEffect(() => {
		current.current = true;
		return () => {
			current.current = false;
		};
	}, []);
	useEffect(() => {
		void revision;
		let active = true;
		setRows(undefined);
		createApiClient(`${window.location.origin}/api/rpc`)
			.files.list({ organizationId, projectId })
			.then((r) => {
				if (active) setRows(r);
			})
			.catch(() => {
				if (active) setError(t("failed"));
			});
		return () => {
			active = false;
		};
	}, [organizationId, projectId, revision, t]);
	async function run(work: () => Promise<void>) {
		setBusy(true);
		setError(undefined);
		try {
			await work();
			if (current.current) setRevision((v) => v + 1);
		} catch {
			if (current.current) setError(t("failed"));
		} finally {
			if (current.current) setBusy(false);
		}
	}
	async function upload() {
		if (!file) {
			setError(t("invalid"));
			return;
		}
		const metadata = fileMetadata.safeParse({
			name: file.name,
			bytes: file.size,
			contentType: file.name.toLowerCase().endsWith(".csv")
				? "text/csv"
				: "text/plain",
		});
		if (!metadata.success) {
			setError(t("invalid"));
			return;
		}
		await run(async () => {
			const bytes = await file.arrayBuffer(),
				hash = await crypto.subtle.digest("SHA-256", bytes),
				sha256 = Array.from(new Uint8Array(hash), (v) =>
					v.toString(16).padStart(2, "0"),
				).join("");
			const api = createApiClient(`${window.location.origin}/api/rpc`);
			operation.current ||= crypto.randomUUID();
			const attempt = await api.files.initiate({
				organizationId,
				projectId,
				operationKey: operation.current,
				...metadata.data,
				sha256,
			});
			const response = await fetch(attempt.url, {
				method: "PUT",
				headers: attempt.headers,
				body: bytes,
				credentials: "omit",
			});
			// A replay can meet an existing staging object; the finalizer verifies the expected digest.
			if (!response.ok && response.status !== 412)
				throw new Error("Upload failed");
			await api.files.finalize({
				organizationId,
				projectId,
				id: attempt.file.id,
			});
			if (current.current) {
				setFile(undefined);
				operation.current = "";
			}
		});
	}
	return (
		<section
			aria-label={t("title")}
			className="platform-activity platform-files"
		>
			<h2>{t("title")}</h2>
			<p>{t("hint")}</p>
			<label htmlFor={`project-file-${projectId}`}>
				{t("choose")}
				<Input
					id={`project-file-${projectId}`}
					type="file"
					accept=".txt,.csv,text/plain,text/csv"
					disabled={busy}
					onChange={(e) => {
						setFile(e.target.files?.[0]);
						operation.current = "";
					}}
				/>
			</label>
			<Button disabled={busy || !file} onClick={() => void upload()}>
				{busy ? t("busy") : t("upload")}
			</Button>
			{error && <p role="alert">{error}</p>}
			<Button
				disabled={busy}
				onClick={() => {
					setError(undefined);
					setRevision((v) => v + 1);
				}}
			>
				{t("retry")}
			</Button>
			{!rows && !error && <p role="status">{t("loading")}</p>}
			{rows?.length === 0 && <p>{t("empty")}</p>}
			<ul>
				{rows?.map((row) => (
					<li key={row.id}>
						{row.name} · {row.bytes} B · {t(row.state)}{" "}
						{row.state === "staging" && (
							<Button
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await createApiClient(
											`${window.location.origin}/api/rpc`,
										).files.finalize({ organizationId, projectId, id: row.id });
									})
								}
							>
								{t("finish")}
							</Button>
						)}
						{row.state === "available" && (
							<Button
								disabled={busy}
								onClick={() =>
									void run(async () => {
										const result = await createApiClient(
											`${window.location.origin}/api/rpc`,
										).files.download({ organizationId, projectId, id: row.id });
										if (!current.current) return;
										const bytes = Uint8Array.from(atob(result.base64), (c) =>
												c.charCodeAt(0),
											),
											url = URL.createObjectURL(
												new Blob([bytes], { type: "application/octet-stream" }),
											),
											anchor = document.createElement("a");
										anchor.href = url;
										anchor.download = row.name;
										anchor.click();
										setTimeout(() => URL.revokeObjectURL(url), 1000);
									})
								}
							>
								{t("download")}
							</Button>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
