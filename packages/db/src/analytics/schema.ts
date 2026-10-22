import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgPolicy,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { foundation } from "../schema";
import type { AnalyticsDeletion } from "./provider";

const time = (n: string) => timestamp(n, { withTimezone: true });
const policies = () => [
	pgPolicy("migration_control", {
		to: ["saas_cook_migrator"],
		for: "all",
		using: sql`true`,
		withCheck: sql`true`,
	}),
	pgPolicy("analytics_control", {
		to: ["saas_cook_lifecycle", "saas_cook_recovery"],
		for: "all",
		using: sql`true`,
		withCheck: sql`true`,
	}),
];
export const analyticsPreferences = foundation
	.table(
		"analytics_preferences",
		{
			subjectKind: text("subject_kind").notNull(),
			subjectId: text("subject_id").notNull(),
			enabled: boolean().notNull(),
			version: integer().notNull().default(1),
		},
		(t) => [
			primaryKey({ columns: [t.subjectKind, t.subjectId] }),
			check(
				"analytics_preference_subject",
				sql`subject_kind IN ('account','organization')`,
			),
			...policies(),
		],
	)
	.enableRLS();
export const analyticsSubjects = foundation
	.table(
		"analytics_subjects",
		{
			id: text().primaryKey(),
			userId: text("user_id").notNull(),
			organizationId: uuid("organization_id"),
			suppressed: boolean().notNull().default(false),
			deletionState: text("deletion_state").notNull().default("none"),
			receipt: jsonb().$type<AnalyticsDeletion>(),
		},
		(t) => [
			index("analytics_subject_user").on(t.userId),
			index("analytics_subject_org").on(t.organizationId),
			check(
				"analytics_deletion_state",
				sql`deletion_state IN ('none','pending','complete')`,
			),
			...policies(),
		],
	)
	.enableRLS();
export const analyticsEvents = foundation
	.table(
		"analytics_events",
		{
			id: uuid().primaryKey(),
			subjectId: text("subject_id")
				.notNull()
				.references(() => analyticsSubjects.id),
			event: text().notNull(),
			feature: text(),
			occurredAt: time("occurred_at").notNull(),
			state: text().notNull().default("pending"),
			attempts: integer().notNull().default(0),
			availableAt: time("available_at").notNull().defaultNow(),
			expiresAt: time("expires_at").notNull(),
			synthetic: boolean().notNull(),
		},
		(t) => [
			index("analytics_delivery_due").on(t.state, t.availableAt),
			check(
				"analytics_event_kind",
				sql`event IN ('account.signed_up','organization.created','onboarding.completed','core_action.completed','subscription.paid_started','subscription.paid_retracted')`,
			),
			check(
				"analytics_event_state",
				sql`state IN ('pending','inflight','delivered','dropped','ambiguous')`,
			),
			check(
				"analytics_feature",
				sql`feature IS NULL OR feature IN ('projects','customers','files','imports','exports')`,
			),
			...policies(),
		],
	)
	.enableRLS();
export const analyticsSeen = foundation
	.table(
		"analytics_seen",
		{ id: uuid().primaryKey(), seenAt: time("seen_at").notNull().defaultNow() },
		() => policies(),
	)
	.enableRLS();
export const analyticsSources = foundation
	.table(
		"analytics_sources",
		{
			id: uuid().primaryKey(),
			userId: text("user_id").notNull(),
			organizationId: uuid("organization_id"),
			event: text().notNull(),
			feature: text(),
			occurredAt: time("occurred_at").notNull().defaultNow(),
		},
		() => policies(),
	)
	.enableRLS();
