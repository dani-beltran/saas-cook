"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { createApiClient } from "@saas-cook/api/client";
import { Button, Input, NativeSelect, NativeSelectOption } from "@saas-cook/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DashboardShell } from "../../components/dashboard-shell";
import { ResourceActivity } from "./activity";

const formSchema = z.object({
	query: z.string().trim().min(1).max(120),
	type: z.enum(["all", "project", "customer"]),
});
type Fields = z.infer<typeof formSchema>;
type Page = Awaited<
	ReturnType<ReturnType<typeof createApiClient>["platform"]["search"]>
>;
export function PlatformSearch({ organizationId }: { organizationId: string }) {
	const t = useTranslations("Discovery");
	const [query, setQuery] = useState<Fields>(),
		[cursor, setCursor] = useState<string>(),
		[page, setPage] = useState<Page>(),
		[failed, setFailed] = useState(false),
		[retry, setRetry] = useState(0),
		[selected, setSelected] = useState<Page["items"][number]>();
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<Fields>({
		resolver: zodResolver(formSchema),
		defaultValues: { query: "", type: "all" },
	});
	useEffect(() => {
		void retry;
		let active = true;
		setPage(undefined);
		setFailed(false);
		setSelected(undefined);
		if (query)
			createApiClient(`${window.location.origin}/api/rpc`)
				.platform.search({
					organizationId,
					query: query.query,
					type: query.type === "all" ? undefined : query.type,
					cursor,
					limit: 25,
				})
				.then((value) => {
					if (active) setPage(value);
				})
				.catch(() => {
					if (active) setFailed(true);
				});
		return () => {
			active = false;
		};
	}, [organizationId, query, cursor, retry]);
	return (
		<DashboardShell section="search" organizationId={organizationId}>
			<header className="dashboard-page-header">
				<div>
					<h1>{t("search")}</h1>
					<p>{t("hint")}</p>
				</div>
			</header>
			<form
				className="platform-search-form"
				onSubmit={handleSubmit((value) => {
					setCursor(undefined);
					setQuery(value);
				})}
			>
				<label htmlFor="platform-query">{t("query")}</label>
				<Input
					id="platform-query"
					maxLength={120}
					aria-invalid={Boolean(errors.query)}
					{...register("query")}
					required
				/>
				<label className="sr-only" htmlFor="platform-type">
					{t("all")}
				</label>
				<NativeSelect id="platform-type" {...register("type")}>
					<NativeSelectOption value="all">{t("all")}</NativeSelectOption>
					<NativeSelectOption value="project">
						{t("project")}
					</NativeSelectOption>
					<NativeSelectOption value="customer">
						{t("customer")}
					</NativeSelectOption>
				</NativeSelect>
				<Button type="submit">{t("search")}</Button>
			</form>
			{failed ? (
				<p role="alert">
					{t("failed")}{" "}
					<Button onClick={() => setRetry((v) => v + 1)}>{t("retry")}</Button>
				</p>
			) : query && !page ? (
				<p role="status">{t("loading")}</p>
			) : page ? (
				<section aria-label={t("search")}>
					{!page.items.length && <p role="status">{t("empty")}</p>}
					<ul className="platform-results">
						{page.items.map((item) => (
							<li key={`${item.type}:${item.id}`}>
								<strong>{item.label}</strong> · {t(item.type)}{" "}
								<Button onClick={() => setSelected(item)}>
									{t("activity")}
								</Button>
							</li>
						))}
					</ul>
					{page.nextCursor && (
						<Button onClick={() => setCursor(page.nextCursor ?? undefined)}>
							{t("next")}
						</Button>
					)}
				</section>
			) : null}
			{selected && (
				<section>
					<h2>{selected.label}</h2>
					<Button onClick={() => setSelected(undefined)}>{t("close")}</Button>
					<ResourceActivity
						key={`${selected.type}:${selected.id}`}
						organizationId={organizationId}
						resourceType={selected.type}
						resourceId={selected.id}
					/>
				</section>
			)}
		</DashboardShell>
	);
}
