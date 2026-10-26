"use client";

import {
	type OrganizationDirectoryInput,
	type OrganizationDirectoryOutput,
	type OrganizationLookupInput,
	organizationDirectoryInput,
	organizationDirectoryOutput,
	organizationLifecycle,
} from "@saas-cook/backoffice-contracts";
import {
	Alert,
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Input,
	NativeSelect,
	NativeSelectOption,
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@saas-cook/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * Shows an assigned organization page, its observation time and bounded continuation.
 * Result is server-validated metadata; the view never infers grants or total counts.
 */
export function DirectoryResults({
	result,
	disabled = false,
	onSelect,
}: {
	result: OrganizationDirectoryOutput;
	disabled?: boolean;
	onSelect?: (id: string) => void;
}) {
	const t = useTranslations("Backoffice.directory");
	const format = useFormatter();
	const timestamp = (value: string) => (
		<time dateTime={value}>
			{format.dateTime(new Date(value), {
				dateStyle: "medium",
				timeStyle: "medium",
				timeZone: "UTC",
			})}{" "}
			UTC
		</time>
	);
	return (
		<div className="bo-result">
			<p>
				<Badge>{t("live")}</Badge> {t("checked")}{" "}
				{timestamp(result.freshness.checkedAt)}
			</p>
			<p className="bo-field-help">{t("freshnessHelp")}</p>
			<p>{t("count", { count: result.items.length })}</p>
			{result.items.length === 0 && (
				<p>{t(result.nextCursor ? "emptyContinue" : "noResults")}</p>
			)}
			<section className="bo-directory-table" aria-label={t("title")}>
				<Table>
					<TableCaption>{t("tableCaption")}</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">{t("name")}</TableHead>
							<TableHead scope="col">{t("id")}</TableHead>
							<TableHead scope="col">{t("stateLabel")}</TableHead>
							<TableHead scope="col">{t("observed")}</TableHead>
							<TableHead scope="col">{t("actions")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{result.items.map((item) => (
							<TableRow key={item.id}>
								<TableCell>{item.name}</TableCell>
								<TableCell>
									<code>{item.id}</code>
								</TableCell>
								<TableCell>{t(`states.${item.lifecycle}`)}</TableCell>
								<TableCell>{timestamp(item.sourceTimestamp)}</TableCell>
								<TableCell>
									<Button
										type="button"
										variant="secondary"
										disabled={disabled || !onSelect}
										aria-label={t("detailsFor", { id: item.id })}
										onClick={() => onSelect?.(item.id)}
									>
										{t("details")}
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</section>
			<p className="bo-field-help">
				{t("audit")} <code>{result.auditReference}</code>
			</p>
		</div>
	);
}

/**
 * Fetches audited directory pages using shared validation and no-store POST requests.
 * Parent remounts on staff authentication actions to discard sensitive state;
 * unmount aborts pending requests. Filters reset pagination and clear previous data.
 */
export function OrganizationDirectory({
	disabled,
	onActivity,
	onUnavailable,
	onLookup,
}: {
	disabled: boolean;
	onActivity?: () => void;
	onUnavailable?: () => void;
	onLookup?: (values: OrganizationLookupInput) => Promise<void>;
}) {
	const t = useTranslations("Backoffice.directory");
	const [organizationId, setOrganizationId] = useState("");
	const [lifecycle, setLifecycle] = useState("");
	const [caseReference, setCaseReference] = useState("");
	const [pageSize, setPageSize] = useState(10);
	const [result, setResult] = useState<OrganizationDirectoryOutput | null>(
		null,
	);
	const [history, setHistory] = useState<OrganizationDirectoryInput[]>([]);
	const [query, setQuery] = useState<OrganizationDirectoryInput | null>(null);
	const [status, setStatus] = useState<
		"idle" | "pending" | "ready" | "invalid" | "unavailable"
	>("idle");
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	const busy = disabled || status === "pending";
	function reset() {
		setResult(null);
		setQuery(null);
		setHistory([]);
		setStatus("idle");
	}
	async function load(direction: "first" | "next" | "previous" = "first") {
		onActivity?.();
		const parsed = organizationDirectoryInput.safeParse(
			direction === "previous"
				? history[history.length - 1]
				: direction === "next" && query
					? { ...query, cursor: result?.nextCursor }
					: {
							organizationId: organizationId.trim() || undefined,
							lifecycle: lifecycle || undefined,
							caseReference,
							pageSize,
						},
		);
		const previous = result;
		setResult(null);
		if (!parsed.success || (direction === "next" && !previous?.nextCursor)) {
			setStatus("invalid");
			return;
		}
		controller.current?.abort();
		const active = new AbortController();
		controller.current = active;
		setStatus("pending");
		try {
			const response = await fetch("/api/organizations/directory", {
				method: "POST",
				cache: "no-store",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(parsed.data),
				signal: active.signal,
			});
			if (!response.ok) throw new Error("Unavailable");
			const page = organizationDirectoryOutput.parse(await response.json());
			if (active.signal.aborted) return;
			setResult(page);
			setHistory(
				direction === "next" && query
					? [...history, query]
					: direction === "previous"
						? history.slice(0, -1)
						: [],
			);
			setQuery(parsed.data);
			setStatus("ready");
		} catch {
			if (!active.signal.aborted) {
				setStatus("unavailable");
				onUnavailable?.();
				setQuery(null);
			}
		}
	}
	return (
		<Card id="organization-directory" aria-labelledby="directory-title">
			<CardHeader>
				<CardTitle id="directory-title">{t("title")}</CardTitle>
				<CardDescription>{t("description")}</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="bo-form"
					noValidate
					aria-busy={busy}
					onSubmit={(event) => {
						event.preventDefault();
						void load();
					}}
				>
					<div className="bo-field">
						<label htmlFor="directory-id">{t("idFilter")}</label>
						<Input
							id="directory-id"
							disabled={busy}
							value={organizationId}
							onChange={(event) => {
								setOrganizationId(event.target.value);
								reset();
							}}
							aria-describedby="directory-help"
						/>
					</div>
					<div className="bo-field">
						<label htmlFor="directory-lifecycle">{t("lifecycle")}</label>
						<NativeSelect
							id="directory-lifecycle"
							disabled={busy}
							value={lifecycle}
							onChange={(event) => {
								setLifecycle(event.target.value);
								reset();
							}}
						>
							<NativeSelectOption value="">{t("allStates")}</NativeSelectOption>
							{organizationLifecycle.options.map((state) => (
								<NativeSelectOption key={state} value={state}>
									{t(`states.${state}`)}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<div className="bo-field">
						<label htmlFor="directory-case">{t("case")}</label>
						<Input
							id="directory-case"
							disabled={busy}
							required
							maxLength={80}
							value={caseReference}
							onChange={(event) => {
								setCaseReference(event.target.value);
								reset();
							}}
							aria-describedby="directory-help"
						/>
					</div>
					<div className="bo-field">
						<label htmlFor="directory-size">{t("pageSize")}</label>
						<NativeSelect
							id="directory-size"
							disabled={busy}
							value={pageSize}
							onChange={(event) => {
								setPageSize(Number(event.target.value));
								reset();
							}}
						>
							{[10, 25, 50].map((size) => (
								<NativeSelectOption key={size} value={size}>
									{size}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<p className="bo-field-help" id="directory-help">
						{t("help")}
					</p>
					<div className="bo-form-actions">
						{result && history.length > 0 && (
							<Button
								type="button"
								variant="secondary"
								disabled={busy}
								onClick={() => void load("previous")}
							>
								{t("previous")}
							</Button>
						)}
						<Button type="submit" disabled={busy}>
							{t(result ? "refresh" : "search")}
						</Button>
						{result?.nextCursor && (
							<Button
								type="button"
								variant="secondary"
								disabled={busy}
								onClick={() => void load("next")}
							>
								{t("next")}
							</Button>
						)}
					</div>
				</form>
				{status !== "idle" && (
					<Alert
						className="bo-feedback bo-directory-feedback"
						variant={
							status === "invalid" || status === "unavailable"
								? "error"
								: "neutral"
						}
						aria-live="polite"
					>
						{t(status)}
					</Alert>
				)}
				{result && (
					<DirectoryResults
						result={result}
						disabled={busy}
						onSelect={
							onLookup && query
								? (id) => {
										void onLookup({
											organizationId: id,
											caseReference: query.caseReference,
										});
									}
								: undefined
						}
					/>
				)}
			</CardContent>
		</Card>
	);
}
