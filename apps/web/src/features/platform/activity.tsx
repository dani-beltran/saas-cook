"use client";
import { createApiClient } from "@saas-cook/api/client";
import { Button } from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import "./platform.css";

type Page = Awaited<
	ReturnType<ReturnType<typeof createApiClient>["platform"]["activity"]>
>;
export function ResourceActivity({
	organizationId,
	resourceType,
	resourceId,
}: {
	organizationId: string;
	resourceType: "project" | "customer";
	resourceId: string;
}) {
	const [cursor, setCursor] = useState<string>(),
		[page, setPage] = useState<Page>(),
		[failed, setFailed] = useState(false),
		[retry, setRetry] = useState(0);
	useEffect(() => {
		void retry;
		let active = true;
		setPage(undefined);
		setFailed(false);
		createApiClient(`${window.location.origin}/api/rpc`)
			.platform.activity({
				organizationId,
				resourceType,
				resourceId,
				cursor,
				limit: 10,
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
	}, [organizationId, resourceType, resourceId, cursor, retry]);
	return (
		<ActivityView
			page={page}
			failed={failed}
			onRetry={() => setRetry((v) => v + 1)}
			onNext={() => setCursor(page?.nextCursor ?? undefined)}
		/>
	);
}
export function ActivityView({
	page,
	failed,
	onRetry,
	onNext,
}: {
	page?: Page;
	failed: boolean;
	onRetry: () => void;
	onNext: () => void;
}) {
	const locale = useLocale();
	const t = useTranslations("Discovery");

	return (
		<section aria-label={t("activity")} className="platform-activity">
			<h2>{t("activity")}</h2>
			{failed ? (
				<p role="alert">
					{t("failed")} <Button onClick={onRetry}>{t("retry")}</Button>
				</p>
			) : !page ? (
				<p role="status">{t("loading")}</p>
			) : (
				<>
					{!page.items.length && <p role="status">{t("noActivity")}</p>}
					<ol>
						{page.items.map((item) => (
							<li key={item.id}>
								<strong>{t(item.action)}</strong> · {t(item.actor)} ·{" "}
								<time dateTime={item.occurredAt}>
									{new Intl.DateTimeFormat(locale, {
										dateStyle: "medium",
										timeStyle: "short",
										timeZone: "UTC",
									}).format(new Date(item.occurredAt))}{" "}
									UTC
								</time>
							</li>
						))}
					</ol>
					{page.nextCursor && <Button onClick={onNext}>{t("next")}</Button>}
				</>
			)}
		</section>
	);
}
