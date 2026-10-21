import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	jsonb,
	pgPolicy,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { foundation } from "../schema";

export const deletionRequests = foundation
	.table(
		"deletion_requests",
		{
			id: uuid().primaryKey(),
			subjectKind: text("subject_kind").notNull(),
			subjectId: text("subject_id").notNull(),
			requesterId: text("requester_id").notNull(),
			operationKey: text("operation_key").notNull(),
			statusHash: text("status_hash").notNull(),
			state: text().notNull().default("awaiting_prerequisites"),
			resolutions: jsonb()
				.$type<
					{
						organizationId: string;
						successorUserId: string;
						transferId: string | null;
					}[]
				>()
				.notNull()
				.default([]),
			organizations: jsonb().$type<string[]>().notNull().default([]),
			retained: jsonb()
				.$type<string[]>()
				.notNull()
				.default([
					"restricted-security-audit",
					"financial-records",
					"backup-expiry",
				]),
			steps: jsonb().$type<string[]>().notNull().default([]),
			journalSequence: bigint("journal_sequence", { mode: "number" }),
			createdAt: timestamp("created_at", { withTimezone: true })
				.notNull()
				.defaultNow(),
			effectiveAt: timestamp("effective_at", { withTimezone: true }),
			completedAt: timestamp("completed_at", { withTimezone: true }),
		},
		(t) => [
			unique("deletion_operation").on(t.requesterId, t.operationKey),
			index("deletion_subject").on(t.subjectKind, t.subjectId),
			check(
				"deletion_subject_kind",
				sql`subject_kind IN ('account','organization')`,
			),
			check(
				"deletion_state",
				sql`state IN ('awaiting_prerequisites','journal_pending','scheduled','purging','complete','canceled')`,
			),
			pgPolicy("migration_control", {
				to: ["saas_cook_migrator"],
				for: "all",
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("lifecycle_control", {
				to: ["saas_cook_lifecycle", "saas_cook_recovery"],
				for: "all",
				using: sql`true`,
				withCheck: sql`true`,
			}),
		],
	)
	.enableRLS();

export const recoveryState = foundation.table(
	"recovery_state",
	{
		epoch: uuid().primaryKey(),
		mode: text().notNull(),
		stage: text().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	() => [
		check("recovery_mode", sql`mode IN ('application','fga-only')`),
		check("recovery_stage", sql`stage IN ('reset','published')`),
	],
);
export const recoveryEnrollments = foundation.table(
	"recovery_enrollments",
	{
		epoch: uuid()
			.notNull()
			.references(() => recoveryState.epoch),
		userId: text("user_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [unique("recovery_enrollment").on(t.epoch, t.userId)],
);
