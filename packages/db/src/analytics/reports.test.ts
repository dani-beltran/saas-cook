import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { AnalyticsEvent } from "./provider";
import { analyticsReports } from "./reports";

it("separates users from mature org cohorts, deduplicates, excludes test traffic and applies paid corrections", () => {
	const event = (
		type: AnalyticsEvent["event"],
		date: string,
		org: string | null = "org",
	): AnalyticsEvent => ({
		id: randomUUID(),
		subject: "user",
		organization: org,
		event: type,
		occurredAt: `2026-09-${date}T00:00:00Z`,
		synthetic: false,
		...(type === "core_action.completed"
			? { feature: "projects" as const }
			: {}),
	});
	const action = event("core_action.completed", "02");
	const events = [
		event("account.signed_up", "01", null),
		event("onboarding.completed", "02", null),
		event("organization.created", "01"),
		action,
		action,
		event("core_action.completed", "08"),
		event("subscription.paid_started", "03"),
		event("subscription.paid_retracted", "04"),
		{ ...event("organization.created", "01", "synthetic"), synthetic: true },
		event("organization.created", "27", "immature"),
	];
	const r = analyticsReports(
		events,
		"2026-09-01T00:00:00Z",
		"2026-09-29T00:00:00Z",
	);
	expect(r).toMatchObject({
		signupUsers: 1,
		onboardedUsers: 1,
		eligibleOrganizations: 1,
		activatedOrganizations: 1,
		paidOrganizations: 0,
	});
	expect(r.adoption[0].organizations).toBe(1);
	expect(r.retention[0]).toMatchObject({ eligible: 1, retained: 1, rate: 1 });
	expect(r.retention[10].rate).toBeNull();
});
