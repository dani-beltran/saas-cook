"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { createApiClient } from "@saas-cook/api/client";
import { Button, Input, NativeSelect, NativeSelectOption } from "@saas-cook/ui";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DashboardShell } from "../../components/dashboard-shell";
import { ResourceActivity } from "./activity";
import { platformMessages } from "./messages";

const formSchema = z.object({
	query: z.string().trim().min(1).max(120),
	type: z.enum(["all", "project", "customer"]),
});
type Fields = z.infer<typeof formSchema>;
type Page = Awaited<
	ReturnType<ReturnType<typeof createApiClient>["platform"]["search"]>
>;
export function PlatformSearch({ organizationId }: { organizationId: string }) {
	const locale = useLocale(),
		copy = platformMessages[locale === "es" ? "es" : "en"];
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
					<h1>{copy.search}</h1>
					<p>{copy.hint}</p>
				</div>
			</header>
			<form
				className="platform-search-form"
				onSubmit={handleSubmit((value) => {
					setCursor(undefined);
					setQuery(value);
				})}
			>
				<label htmlFor="platform-query">{copy.query}</label>
				<Input
					id="platform-query"
					maxLength={120}
					aria-invalid={Boolean(errors.query)}
					{...register("query")}
					required
				/>
				<label className="sr-only" htmlFor="platform-type">
					{copy.all}
				</label>
				<NativeSelect id="platform-type" {...register("type")}>
					<NativeSelectOption value="all">{copy.all}</NativeSelectOption>
					<NativeSelectOption value="project">
						{copy.project}
					</NativeSelectOption>
					<NativeSelectOption value="customer">
						{copy.customer}
					</NativeSelectOption>
				</NativeSelect>
				<Button type="submit">{copy.search}</Button>
			</form>
			{failed ? (
				<p role="alert">
					{copy.failed}{" "}
					<Button onClick={() => setRetry((v) => v + 1)}>{copy.retry}</Button>
				</p>
			) : query && !page ? (
				<p role="status">{copy.loading}</p>
			) : page ? (
				<section aria-label={copy.search}>
					{!page.items.length && <p role="status">{copy.empty}</p>}
					<ul className="platform-results">
						{page.items.map((item) => (
							<li key={`${item.type}:${item.id}`}>
								<strong>{item.label}</strong> · {copy[item.type]}{" "}
								<Button onClick={() => setSelected(item)}>
									{copy.activity}
								</Button>
							</li>
						))}
					</ul>
					{page.nextCursor && (
						<Button onClick={() => setCursor(page.nextCursor ?? undefined)}>
							{copy.next}
						</Button>
					)}
				</section>
			) : null}
			{selected && (
				<section>
					<h2>{selected.label}</h2>
					<Button onClick={() => setSelected(undefined)}>{copy.close}</Button>
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
