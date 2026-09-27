"use client";
import type {
	CustomerDto,
	CustomerQuery,
} from "@common-saas/api-contracts/example-customers";
import { Button, Input } from "@common-saas/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { DashboardShell } from "../../components/dashboard-shell";
import { CustomerForm, type CustomerFormValues } from "./customer-form";
import { CustomerTable } from "./customer-table";
import { type CustomerCopy, customerMessages } from "./messages";
import { queryFromUrl, queryUrl } from "./query";
import { customersApi, useCustomers } from "./use-customers";
import "./customers.css";

type Editor = {
	action: "create" | "view" | "edit" | "delete";
	customer?: CustomerDto;
};
type Failure = { code?: string };
export function Customers({ organizationId }: { organizationId: string }) {
	const params = useSearchParams(),
		path = usePathname(),
		router = useRouter();
	const query = queryFromUrl(params),
		key = `${organizationId}:${params.toString()}`;
	const navigationFocus = useRef<string | null>(null);
	useEffect(() => {
		void key;
		if (navigationFocus.current)
			document.getElementById(navigationFocus.current)?.focus();
		navigationFocus.current = null;
	}, [key]);
	return (
		<DashboardShell section="customers" organizationId={organizationId}>
			<Directory
				key={key}
				organizationId={organizationId}
				query={query}
				changeQuery={(next) => {
					navigationFocus.current = document.activeElement?.id ?? null;
					router.push(`${path}?${queryUrl(next)}`, { scroll: false });
				}}
			/>
		</DashboardShell>
	);
}
function failureText(failure: unknown, copy: CustomerCopy, list = false) {
	const code = (failure as Failure)?.code;
	return code === "CONFLICT"
		? copy.stale
		: code === "UNAUTHORIZED"
			? copy.reauthenticate
			: code === "FORBIDDEN"
				? copy.denied
				: code === "NOT_FOUND"
					? copy.missing
					: code === "UNPROCESSABLE_CONTENT"
						? list
							? copy.invalidQuery
							: copy.invalid
						: list
							? copy.listFailed
							: copy.failed;
}
function Directory({
	organizationId,
	query,
	changeQuery,
}: {
	organizationId: string;
	query: CustomerQuery;
	changeQuery: (value: CustomerQuery) => void;
}) {
	const locale = useLocale(),
		copy = customerMessages[locale === "es" ? "es" : "en"];
	const state = useCustomers(organizationId, query);
	const [search, setSearch] = useState(query.search),
		[editor, setEditor] = useState<Editor | null>(null),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<unknown>(null),
		[notice, setNotice] = useState("");
	const dialog = useRef<HTMLDialogElement>(null),
		trigger = useRef<HTMLElement | null>(null),
		add = useRef<HTMLButtonElement>(null),
		busyRef = useRef(false);
	const operation = useRef<{ input: string; key: string } | null>(null),
		detailRequest = useRef(0);
	const [editorRevision, setEditorRevision] = useState(0);
	// Compose rapid filter changes even before the router commits the prior URL.
	const pendingQuery = useRef(query);
	const update = (value: Partial<CustomerQuery>) => {
		pendingQuery.current = {
			...pendingQuery.current,
			...value,
			cursor: undefined,
		};
		changeQuery(pendingQuery.current);
	};
	const close = () => {
		if (busyRef.current) return;
		detailRequest.current++;
		setEditor(null);
		setError(null);
	};
	useEffect(() => {
		if (editor) {
			dialog.current?.showModal();
		} else {
			dialog.current?.close();
			const target = trigger.current?.isConnected
				? trigger.current
				: add.current;
			if (trigger.current) target?.focus();
		}
	}, [editor]);
	async function open(action: Editor["action"], customer?: CustomerDto) {
		trigger.current = document.activeElement as HTMLElement;
		setError(null);
		operation.current = null;
		setEditorRevision(0);
		if (!customer) {
			setEditor({ action });
			return;
		}
		const request = ++detailRequest.current;
		setEditor({ action, customer });
		setBusy(true);
		busyRef.current = true;
		try {
			const current = await customersApi().get({
				organizationId,
				id: customer.id,
			});
			if (state.alive.current && request === detailRequest.current) {
				setEditor({ action, customer: current });
				setEditorRevision((x) => x + 1);
			}
		} catch (failure) {
			if (state.alive.current && request === detailRequest.current)
				setError(failure);
		} finally {
			if (state.alive.current && request === detailRequest.current) {
				setBusy(false);
				busyRef.current = false;
			}
		}
	}
	async function save(values?: CustomerFormValues) {
		if (!editor || busyRef.current) return;
		const current = editor;
		const payload = {
			...values,
			...(current.customer
				? { id: current.customer.id, version: current.customer.version }
				: {}),
		};
		const fingerprint = JSON.stringify({ action: current.action, ...payload });
		if (operation.current?.input !== fingerprint)
			operation.current = { input: fingerprint, key: crypto.randomUUID() };
		setBusy(true);
		busyRef.current = true;
		setError(null);
		try {
			if (current.action === "delete" && current.customer)
				await customersApi().delete({
					organizationId,
					id: current.customer.id,
					version: current.customer.version,
					operationKey: operation.current.key,
				});
			else if (values && current.customer)
				await customersApi().update({
					organizationId,
					...values,
					id: current.customer.id,
					version: current.customer.version,
					operationKey: operation.current.key,
				});
			else if (values)
				await customersApi().create({
					organizationId,
					...values,
					operationKey: operation.current.key,
				});
			if (!state.alive.current) return;
			setEditor(null);
			setNotice(current.action === "delete" ? copy.deleted : copy.saved);
			state.reload();
		} catch (failure) {
			if (state.alive.current) setError(failure);
		} finally {
			if (state.alive.current) {
				setBusy(false);
				busyRef.current = false;
			}
		}
	}
	async function latest() {
		if (!editor?.customer || busyRef.current) return;
		setBusy(true);
		busyRef.current = true;
		try {
			const row = await customersApi().get({
				organizationId,
				id: editor.customer.id,
			});
			if (state.alive.current) {
				setEditor({ ...editor, customer: row });
				setEditorRevision((x) => x + 1);
				setError(null);
				operation.current = null;
			}
		} catch (e) {
			if (state.alive.current) setError(e);
		} finally {
			if (state.alive.current) {
				setBusy(false);
				busyRef.current = false;
			}
		}
	}
	const feedback = (failure: unknown, list = false) => (
		<div role="alert" className="customers-error customers-notice">
			<p>{failureText(failure, copy, list)}</p>
			{["FORBIDDEN", "UNAUTHORIZED"].includes(
				(failure as Failure)?.code ?? "",
			) && (
				<a
					href={`/${locale}/account#security`}
					target="_blank"
					rel="noreferrer"
				>
					{copy.security} ↗
				</a>
			)}
		</div>
	);
	const filtered = Boolean(query.search || query.status);
	return (
		<section className="customers-feature">
			<header className="dashboard-page-header">
				<div>
					<p className="customers-eyebrow">{copy.example}</p>
					<h1>{copy.title}</h1>
					<p className="customers-muted">{copy.description}</p>
				</div>
				<Button ref={add} onClick={() => void open("create")}>
					<span aria-hidden="true">＋</span> {copy.add}
				</Button>
			</header>
			<p className="customers-muted customers-access-note">{copy.readOnly}</p>
			{notice && (
				<p className="customers-notice" role="status">
					{notice}
				</p>
			)}
			<div className="customers-panel">
				<div className="customers-toolbar">
					<form
						className="customers-search"
						onSubmit={(event) => {
							event.preventDefault();
							update({ search });
						}}
					>
						<label htmlFor="customers-search">{copy.search}</label>
						<div>
							<Input
								id="customers-search"
								type="search"
								value={search}
								maxLength={120}
								placeholder={copy.searchHint}
								onChange={(e) => setSearch(e.target.value)}
							/>
							<Button type="submit" className="customers-secondary">
								{copy.apply}
							</Button>
						</div>
					</form>
					<div className="customers-field">
						<label htmlFor="customers-status">{copy.status}</label>
						<select
							id="customers-status"
							value={query.status ?? ""}
							onChange={(e) =>
								update({
									status: (e.target.value ||
										undefined) as CustomerQuery["status"],
								})
							}
						>
							<option value="">{copy.all}</option>
							{(["lead", "active", "inactive"] as const).map((s) => (
								<option key={s} value={s}>
									{copy[s]}
								</option>
							))}
						</select>
					</div>
					<Button
						className="customers-secondary customers-clear"
						disabled={!filtered}
						onClick={() => update({ search: "", status: undefined })}
					>
						{copy.clear}
					</Button>
				</div>
				<div className="customers-options">
					<div>
						<label htmlFor="customers-sort">{copy.sort}</label>
						<select
							id="customers-sort"
							value={query.sort}
							onChange={(e) =>
								update({ sort: e.target.value as CustomerQuery["sort"] })
							}
						>
							{(["createdAt", "name", "company"] as const).map((s) => (
								<option key={s} value={s}>
									{copy[s]}
								</option>
							))}
						</select>
						<label className="sr-only" htmlFor="customers-direction">
							{copy.direction}
						</label>
						<select
							id="customers-direction"
							value={query.direction}
							onChange={(e) =>
								update({
									direction: e.target.value as CustomerQuery["direction"],
								})
							}
						>
							<option value="desc">{copy.desc}</option>
							<option value="asc">{copy.asc}</option>
						</select>
					</div>
					<div>
						<label htmlFor="customers-size">{copy.size}</label>
						<select
							id="customers-size"
							value={query.limit}
							onChange={(e) =>
								update({
									limit: Number(e.target.value) as CustomerQuery["limit"],
								})
							}
						>
							{[10, 25, 50].map((n) => (
								<option key={n}>{n}</option>
							))}
						</select>
					</div>
				</div>
				<div aria-busy={state.loading}>
					{state.loading ? (
						<div className="customers-empty" role="status">
							{copy.loading}
						</div>
					) : state.error ? (
						<div className="customers-empty">
							{feedback(state.error, true)}
							<Button className="customers-secondary" onClick={state.reload}>
								{copy.retry}
							</Button>
							{(state.error as Failure).code === "UNPROCESSABLE_CONTENT" && (
								<Button
									onClick={() => {
										state.reset();
										changeQuery(queryFromUrl(new URLSearchParams()));
									}}
								>
									{copy.clear}
								</Button>
							)}
						</div>
					) : state.items.length ? (
						<CustomerTable
							items={state.items}
							copy={copy}
							locale={locale}
							query={query}
							onSort={(sort) =>
								update({
									sort,
									direction:
										query.sort === sort && query.direction === "asc"
											? "desc"
											: "asc",
								})
							}
							onAction={(action, customer) => void open(action, customer)}
						/>
					) : (
						<div className="customers-empty">
							<span className="customers-empty-icon" aria-hidden="true">
								◎
							</span>
							<h2>{filtered ? copy.noResults : copy.empty}</h2>
							<p>{filtered ? copy.noResultsHint : copy.emptyHint}</p>
							<Button
								className="customers-secondary"
								onClick={() =>
									filtered
										? update({ search: "", status: undefined })
										: void open("create")
								}
							>
								{filtered ? copy.clear : copy.add}
							</Button>
						</div>
					)}
				</div>
				<footer className="customers-footer">
					<p className="customers-muted">{copy.sortHint}</p>
					<nav aria-label={copy.pagination}>
						<Button
							className="customers-secondary"
							disabled={state.loading || !state.hasPrevious}
							onClick={state.previous}
						>
							{copy.previous}
						</Button>
						<Button
							className="customers-secondary"
							disabled={state.loading || !state.next}
							onClick={state.advance}
						>
							{copy.next}
						</Button>
					</nav>
				</footer>
			</div>
			<p className="sr-only" role="status" aria-live="polite">
				{!state.loading && !state.error
					? `${copy.loaded} ${state.items.length} ${copy.rows}.`
					: ""}
			</p>
			<dialog
				ref={dialog}
				className="customers-dialog"
				aria-labelledby="customer-dialog-title"
				aria-describedby={
					editor?.action === "delete" ? "customer-delete-effect" : undefined
				}
				onCancel={(event) => {
					event.preventDefault();
					close();
				}}
				onClose={() => {
					if (!busyRef.current) setEditor(null);
				}}
			>
				{editor && (
					<>
						<div className="customers-dialog-header">
							<h2 id="customer-dialog-title">
								{editor.action === "create"
									? copy.add
									: editor.action === "delete"
										? copy.deleteTitle
										: editor.action === "view"
											? copy.view
											: copy.edit}
							</h2>
							<button
								type="button"
								className="customers-close"
								disabled={busy}
								aria-label={copy.close}
								onClick={close}
							>
								×
							</button>
						</div>
						{error && feedback(error)}
						{(error as Failure)?.code === "CONFLICT" && (
							<Button
								className="customers-secondary"
								disabled={busy}
								onClick={() => void latest()}
							>
								{copy.reload}
							</Button>
						)}
						{editor.action === "delete" ? (
							<>
								<p className="customers-delete-name">{editor.customer?.name}</p>
								<p id="customer-delete-effect" className="customers-muted">
									{copy.deleteEffect}
								</p>
								<div className="customers-dialog-actions">
									<Button
										className="customers-secondary"
										disabled={busy}
										onClick={close}
									>
										{copy.cancel}
									</Button>
									<Button
										className="customers-danger"
										disabled={busy}
										onClick={() => void save()}
									>
										{busy ? copy.deleting : copy.confirmDelete}
									</Button>
								</div>
							</>
						) : editor.action === "view" && editor.customer ? (
							<>
								<dl className="customers-details">
									{(
										[
											"name",
											"email",
											"company",
											"status",
											"createdAt",
											"updatedAt",
										] as const
									).map((field) => (
										<div key={field}>
											<dt>{copy[field]}</dt>
											<dd>
												{field === "status"
													? copy[editor.customer?.status ?? "lead"]
													: field === "createdAt" || field === "updatedAt"
														? new Intl.DateTimeFormat(locale, {
																dateStyle: "long",
																timeStyle: "short",
																timeZone: "UTC",
															}).format(
																new Date(editor.customer?.[field] ?? ""),
															)
														: (editor.customer?.[field] ?? copy.notProvided)}
											</dd>
										</div>
									))}
								</dl>
								<Button
									disabled={busy}
									onClick={() => {
										setError(null);
										setEditor({ ...editor, action: "edit" });
									}}
								>
									{copy.edit}
								</Button>
							</>
						) : (
							<CustomerForm
								key={`${editor.customer?.id ?? "new"}:${editorRevision}`}
								copy={copy}
								busy={busy}
								initial={
									editor.customer
										? {
												name: editor.customer.name,
												email: editor.customer.email,
												company: editor.customer.company ?? "",
												status: editor.customer.status,
											}
										: undefined
								}
								onSave={save}
								onCancel={close}
							/>
						)}
					</>
				)}
			</dialog>
		</section>
	);
}
