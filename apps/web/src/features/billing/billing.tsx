"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { createApiClient } from "@saas-cook/api/client";
import type {
	BillingCommand,
	BillingPreview,
	BillingSnapshot,
} from "@saas-cook/api-contracts";
import { billingSelection as schema } from "@saas-cook/api-contracts/inputs/billing";
import {
	Button,
	Input,
	NativeSelect,
	NativeSelectOption,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@saas-cook/ui";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { DashboardShell } from "../../components/dashboard-shell";
import { billingMessages } from "./messages";
import { formatBillingAmount } from "./money";
import "./billing.css";

type Locale = "en" | "es";
function failure(error: unknown, locale: Locale) {
	const t = billingMessages[locale],
		code = (error as { code?: string })?.code;
	return code === "FORBIDDEN"
		? t.denied
		: code === "UNAUTHORIZED"
			? t.signIn
			: code === "CONFLICT"
				? t.conflict
				: code === "PRECONDITION_FAILED"
					? t.quota
					: t.failed;
}
export function BillingPage({
	organizationId,
	usageOnly = false,
}: {
	organizationId: string;
	usageOnly?: boolean;
}) {
	const locale: Locale = useLocale() === "es" ? "es" : "en",
		t = billingMessages[locale];
	const [data, setData] = useState<BillingSnapshot | null>(null),
		[error, setError] = useState(""),
		[loading, setLoading] = useState(true),
		[busy, setBusy] = useState(false),
		[preview, setPreview] = useState<BillingPreview | null>(null);
	const request = useRef(0),
		operation = useRef<{ hash: string; key: string } | null>(null);
	const form = useForm<z.infer<typeof schema>>({
		resolver: zodResolver(schema),
		defaultValues: { planVersionId: "", quantity: 1 },
	});
	const load = useCallback(async () => {
		const generation = ++request.current;
		setLoading(true);
		try {
			const result = await createApiClient(
				`${window.location.origin}/api/rpc`,
			).billing.get({ organizationId });
			if (generation === request.current) {
				setData(result);
				setError("");
			}
		} catch (e) {
			if (generation === request.current) setError(failure(e, locale));
		} finally {
			if (generation === request.current) setLoading(false);
		}
	}, [organizationId, locale]);
	useEffect(() => {
		void load();
		return () => {
			request.current++;
		};
	}, [load]);
	const pending = data?.commands.some(
		(c) => c.state === "pending" || c.state === "submitted",
	);
	useEffect(() => {
		if (!pending) return;
		const timer = setInterval(() => {
			void load();
		}, 2500);
		return () => clearInterval(timer);
	}, [pending, load]);
	async function command(
		input:
			| Omit<Extract<BillingCommand, { kind: "checkout" }>, "operationKey">
			| Omit<Extract<BillingCommand, { kind: "change" }>, "operationKey">
			| { kind: "cancel" | "portal" },
	) {
		const hash = JSON.stringify(input);
		if (operation.current?.hash !== hash)
			operation.current = { hash, key: crypto.randomUUID() };
		setBusy(true);
		setError("");
		try {
			await createApiClient(
				`${window.location.origin}/api/rpc`,
			).billing.command({
				organizationId,
				command: {
					...input,
					operationKey: operation.current.key,
				} as BillingCommand,
			});
			operation.current = null;
			setPreview(null);
			await load();
		} catch (e) {
			setError(failure(e, locale));
		} finally {
			setBusy(false);
		}
	}
	async function select(values: z.infer<typeof schema>) {
		setPreview(null);
		if (
			!data ||
			["none", "canceled", "incomplete_expired"].includes(data.providerStatus)
		) {
			await command({ kind: "checkout", selection: values, locale });
			return;
		}
		setBusy(true);
		setError("");
		try {
			setPreview(
				await createApiClient(
					`${window.location.origin}/api/rpc`,
				).billing.preview({ organizationId, selection: values }),
			);
		} catch (e) {
			setError(failure(e, locale));
		} finally {
			setBusy(false);
		}
	}
	const subscribed =
		data &&
		!["none", "canceled", "incomplete_expired"].includes(data.providerStatus);
	return (
		<DashboardShell
			section={usageOnly ? "usage" : "billing"}
			organizationId={organizationId}
		>
			<div className="billing-page">
				<header>
					<div>
						<p className="billing-eyebrow">{t.local}</p>
						<h1>{usageOnly ? t.usageTitle : t.title}</h1>
						<p>{usageOnly ? t.usageSubtitle : t.subtitle}</p>
					</div>
					<Button
						variant="secondary"
						onClick={() => void load()}
						disabled={loading}
					>
						{t.retry}
					</Button>
				</header>
				{error && (
					<p role="alert" className="billing-alert">
						{error}
					</p>
				)}
				{loading && !data && <p role="status">{t.loading}</p>}
				{data && (
					<>
						<BillingOverview
							data={data}
							locale={locale}
							usageOnly={usageOnly}
						/>
						{!usageOnly && data.enabled && (
							<section className="billing-panel" aria-labelledby="plan-title">
								<h2 id="plan-title">{t.plan}</h2>
								{data.plans.length === 0 ? (
									<p>{t.noPlans}</p>
								) : (
									<form onSubmit={form.handleSubmit(select)}>
										<div className="billing-fields">
											<label htmlFor="billing-plan">
												{t.select}
												<NativeSelect
													id="billing-plan"
													{...form.register("planVersionId")}
													onChange={(e) => {
														void form.register("planVersionId").onChange(e);
														setPreview(null);
														const p = data.plans.find(
															(p) => p.id === e.target.value,
														);
														if (p?.mode === "fixed")
															form.setValue("quantity", 1);
													}}
												>
													<NativeSelectOption value="">
														{t.select}
													</NativeSelectOption>
													{data.plans.map((p) => (
														<NativeSelectOption key={p.id} value={p.id}>
															{p.name} · {p.id} ·{" "}
															{formatBillingAmount(
																p.amount,
																p.currency,
																locale,
															)}{" "}
															/{" "}
															{p.interval === "month"
																? locale === "es"
																	? "mes"
																	: "month"
																: locale === "es"
																	? "año"
																	: "year"}
														</NativeSelectOption>
													))}
												</NativeSelect>
											</label>
											<label htmlFor="billing-quantity">
												{t.quantity}
												<Input
													id="billing-quantity"
													type="number"
													min={1}
													max={100000}
													{...form.register("quantity", {
														valueAsNumber: true,
													})}
												/>
											</label>
										</div>
										{Object.keys(form.formState.errors).length > 0 && (
											<p role="alert">{t.invalid}</p>
										)}
										<Button type="submit" disabled={busy || pending}>
											{busy ? t.saving : subscribed ? t.preview : t.submit}
										</Button>
									</form>
								)}
								{preview && (
									<div className="billing-preview" role="status">
										<h3>{t.previewTitle}</h3>
										<p>
											{t.estimate}:{" "}
											{formatBillingAmount(
												preview.amount,
												preview.currency,
												locale,
											)}
										</p>
										<p>
											{t.effective}:{" "}
											{new Date(preview.effectiveAt).toLocaleString(locale)} ·{" "}
											{t.expires}:{" "}
											{new Date(preview.expiresAt).toLocaleTimeString(locale)}
										</p>
										<Button
											disabled={
												busy || new Date(preview.expiresAt) <= new Date()
											}
											onClick={() =>
												void command({ kind: "change", previewId: preview.id })
											}
										>
											{t.confirm}
										</Button>
									</div>
								)}
								<div className="billing-actions">
									<Button
										variant="secondary"
										disabled={busy || !subscribed}
										onClick={() => void command({ kind: "portal" })}
									>
										{t.portal}
									</Button>
									<Button
										variant="secondary"
										disabled={busy || pending || !subscribed || !!data.cancelAt}
										onClick={() => void command({ kind: "cancel" })}
									>
										{t.cancel}
									</Button>
								</div>
							</section>
						)}
					</>
				)}
			</div>
		</DashboardShell>
	);
}
export function BillingOverview({
	data,
	locale,
	usageOnly = false,
}: {
	data: BillingSnapshot;
	locale: Locale;
	usageOnly?: boolean;
}) {
	const t = billingMessages[locale],
		state = (value: string) =>
			t.states[value as keyof typeof t.states] ?? value,
		date = (value: string | null) =>
			value
				? new Date(value).toLocaleString(locale, { timeZone: "UTC" })
				: t.unavailable;
	const allowance =
		data.usage.policy.kind === "limited"
			? data.usage.policy.limit
			: data.usage.policy.kind === "unlimited"
				? t.unlimited
				: data.usage.policy.kind === "missing"
					? t.missing
					: t.disabled;
	return (
		<>
			{!data.enabled && <p className="billing-note">{t.localHint}</p>}
			{data.commands.some((c) =>
				["pending", "submitted"].includes(c.state),
			) && (
				<p role="status" className="billing-note">
					{t.pending}
				</p>
			)}
			{data.commands.some((c) => ["review", "failed"].includes(c.state)) && (
				<p role="alert" className="billing-alert">
					{t.commandFailed}
				</p>
			)}
			{data.commands
				.filter((c) => c.url && c.state === "complete")
				.slice(0, 1)
				.map((c) => (
					<a
						className="billing-hosted"
						key={c.id}
						href={c.url ?? undefined}
						rel="noreferrer"
					>
						{t.continue} ↗
					</a>
				))}
			{!usageOnly && (
				<div className="billing-cards">
					<section className="billing-panel">
						<h2>{t.status}</h2>
						<strong className="billing-value">{state(data.accessState)}</strong>
						<p>
							{state(data.providerStatus)} · {data.planVersionId ?? t.local}
						</p>
						{data.cancelAt && (
							<p>
								{t.cancelDate}: {date(data.cancelAt)}
							</p>
						)}
						{data.trialEnd && (
							<p>
								{t.trialEnd}: {date(data.trialEnd)}
							</p>
						)}
						{data.graceEnd && (
							<p>
								{t.graceEnd}: {date(data.graceEnd)}
							</p>
						)}
						{data.scheduled && (
							<p>
								{t.scheduled}: {data.scheduled.quantity} ·{" "}
								{date(data.scheduled.effectiveAt)}
							</p>
						)}
					</section>
					<section className="billing-panel">
						<h2>{t.seats}</h2>
						<strong className="billing-value">
							{data.seats.occupied} / {data.seats.capacity}
						</strong>
						<p>
							{t.occupied} / {t.capacity}
						</p>
						{data.seats.overCapacity && <p role="alert">{t.over}</p>}
					</section>
					<section className="billing-panel">
						<h2>{t.reconciliation}</h2>
						<strong>{state(data.health)}</strong>
						<p>
							{t.confirmed}: {date(data.reconciledAt)}
						</p>
						<p>
							{t.valid}: {date(data.snapshotValidUntil)}
						</p>
					</section>
				</div>
			)}
			<section className="billing-panel">
				<h2>{t.usageTitle}</h2>
				<div className="billing-usage">
					<div>
						<strong className="billing-value">
							{data.usage.consumed} / {allowance}
						</strong>
						<p>
							{t.consumed} / {t.allowance} · {t.reserved}: {data.usage.reserved}
						</p>
					</div>
					<p>
						{t.reset}: {date(data.usage.periodEnd)} UTC
					</p>
				</div>
				{data.usage.policy.kind === "limited" &&
					data.usage.policy.limit > 0 && (
						<progress
							aria-label={t.consumed}
							value={Math.min(data.usage.consumed, data.usage.policy.limit)}
							max={data.usage.policy.limit}
						/>
					)}
				<p>{t.usageHint}</p>
			</section>
			{!usageOnly && (
				<section className="billing-panel">
					<h2>{t.invoices}</h2>
					{data.invoices.length === 0 ? (
						<p>{t.empty}</p>
					) : (
						<div className="billing-table">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t.date}</TableHead>
										<TableHead>{t.status}</TableHead>
										<TableHead>{t.amount}</TableHead>
										<TableHead>{t.paid}</TableHead>
										<TableHead>{t.invoices}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data.invoices.map((i) => (
										<TableRow key={i.id}>
											<TableCell>{date(i.periodStart)}</TableCell>
											<TableCell>{state(i.status)}</TableCell>
											<TableCell>
												{formatBillingAmount(i.amountDue, i.currency, locale)}
											</TableCell>
											<TableCell>
												{formatBillingAmount(i.amountPaid, i.currency, locale)}
											</TableCell>
											<TableCell>
												{i.hostedUrl && (
													<a href={i.hostedUrl} rel="noreferrer">
														{t.view} ↗
													</a>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</section>
			)}
		</>
	);
}
