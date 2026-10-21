import type { AnalyticsEvent } from "./provider";

const day = 86400000,
	week = 7 * day;
const weekStart = (n: number) => {
	const d = new Date(n);
	d.setUTCHours(0, 0, 0, 0);
	return d.getTime() - ((d.getUTCDay() + 6) % 7) * day;
};
/** Version 1. UTC half-open windows; cohorts need a full seven-day activation observation. */
export function analyticsReports(
	events: readonly AnalyticsEvent[],
	start: string,
	end: string,
) {
	const from = Date.parse(start),
		to = Date.parse(end);
	if (
		!Number.isFinite(from) ||
		!Number.isFinite(to) ||
		to <= from ||
		to - from > 90 * day ||
		events.length > 100000
	)
		throw new Error("Bounded analytics window required");
	const dedup = [
		...new Map(
			events
				.filter((e) => !e.synthetic && Date.parse(e.occurredAt) < to)
				.map((e) => [e.id, e]),
		).values(),
	].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
	const signups = new Set<string>(),
		onboarded = new Set<string>(),
		created = new Map<string, number>(),
		actions = new Map<string, AnalyticsEvent[]>(),
		paid = new Set<string>();
	const adoption = new Map<string, Set<string>>();
	for (const e of dedup) {
		const time = Date.parse(e.occurredAt);
		if (e.event === "account.signed_up" && time >= from) signups.add(e.subject);
		if (e.event === "onboarding.completed") onboarded.add(e.subject);
		if (e.organization) {
			if (e.event === "organization.created" && !created.has(e.organization))
				created.set(e.organization, time);
			if (e.event === "core_action.completed") {
				actions.set(e.organization, [
					...(actions.get(e.organization) ?? []),
					e,
				]);
				if (time >= from && e.feature) {
					const k = `${new Date(weekStart(time)).toISOString().slice(0, 10)}:${e.feature}`;
					if (!adoption.has(k)) adoption.set(k, new Set());
					adoption.get(k)?.add(e.organization);
				}
			}
			if (e.event === "subscription.paid_started") paid.add(e.organization);
			if (e.event === "subscription.paid_retracted")
				paid.delete(e.organization);
		}
	}
	const cohort = [...created].filter(
			([, time]) => time >= from && time + week <= to,
		),
		activated: { org: string; at: number }[] = [];
	for (const [org, at] of cohort) {
		const first = actions
			.get(org)
			?.find(
				(e) =>
					Date.parse(e.occurredAt) >= at &&
					Date.parse(e.occurredAt) < at + week,
			);
		if (first) activated.push({ org, at: Date.parse(first.occurredAt) });
	}
	const retention = Array.from({ length: 12 }, (_, i) => {
		const offset = i + 1;
		const eligible = activated.filter(
			(a) => weekStart(a.at) + (offset + 1) * week <= to,
		);
		const retained = eligible.filter((a) =>
			actions
				.get(a.org)
				?.some(
					(e) =>
						weekStart(Date.parse(e.occurredAt)) ===
						weekStart(a.at) + offset * week,
				),
		);
		return {
			week: offset,
			eligible: eligible.length,
			retained: retained.length,
			rate: eligible.length ? retained.length / eligible.length : null,
		};
	});
	return {
		version: 1 as const,
		timezone: "UTC",
		start,
		end,
		signupUsers: signups.size,
		onboardedUsers: [...signups].filter((id) => onboarded.has(id)).length,
		eligibleOrganizations: cohort.length,
		activatedOrganizations: activated.length,
		paidOrganizations: cohort.filter(([org]) => paid.has(org)).length,
		adoption: [...adoption]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, orgs]) => ({
				week: key.slice(0, 10),
				feature: key.slice(11),
				organizations: orgs.size,
			})),
		retention,
	};
}
