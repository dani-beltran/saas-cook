import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgPolicy,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { StoredObject } from "../files/storage";
import { organizations, tenancy } from "../tenancy-schema";

const policies = () => [
	pgPolicy("migration_control", {
		to: ["saas_cook_migrator"],
		for: "all",
		using: sql`true`,
		withCheck: sql`true`,
	}),
	pgPolicy("tenant_isolation", {
		to: ["public"],
		for: "all",
		using: sql`organization_id=nullif(current_setting('app.organization_id',true),'')::uuid`,
		withCheck: sql`organization_id=nullif(current_setting('app.organization_id',true),'')::uuid`,
	}),
];
export const bulkJobs = tenancy
	.table(
		"bulk_jobs",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			requesterId: text("requester_id").notNull(),
			sessionId: text("session_id").notNull(),
			epoch: uuid().notNull(),
			operationKey: text("operation_key").notNull(),
			inputHash: text("input_hash").notNull(),
			kind: text().notNull(),
			input: jsonb().notNull(),
			state: text().notNull().default("pending"),
			attempts: integer().notNull().default(0),
			availableAt: timestamp("available_at", { withTimezone: true })
				.notNull()
				.defaultNow(),
			progress: integer().notNull().default(0),
			total: integer().notNull().default(0),
			errors: jsonb()
				.$type<{ row: number; code: string }[]>()
				.notNull()
				.default([]),
			manifest: jsonb()
				.$type<
					{
						id: string;
						version: number;
						kind?: "project" | "customer" | "organization" | "file";
					}[]
				>()
				.notNull()
				.default([]),
			draft: text(),
			object: jsonb().$type<StoredObject>(),
			reservationId: uuid("reservation_id"),
			createdAt: timestamp("created_at", { withTimezone: true })
				.notNull()
				.defaultNow(),
			expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		},
		(t) => [
			unique("bulk_operation").on(
				t.organizationId,
				t.requesterId,
				t.operationKey,
			),
			unique("bulk_org_id").on(t.organizationId, t.id),
			check(
				"bulk_kind",
				sql`kind IN ('projects.import','projects.export','organization.export','audit.export')`,
			),
			check(
				"bulk_state",
				sql`state IN ('pending','running','complete','failed','canceled','expired')`,
			),
			check(
				"bulk_bound",
				sql`progress BETWEEN 0 AND 1000 AND total BETWEEN 0 AND 1000`,
			),
			index("bulk_due").on(t.state, t.createdAt),
			...policies(),
		],
	)
	.enableRLS();
export const bulkRows = tenancy
	.table(
		"bulk_rows",
		{
			organizationId: uuid("organization_id").notNull(),
			jobId: uuid("job_id").notNull(),
			row: integer().notNull(),
			state: text().notNull(),
			resourceId: uuid("resource_id"),
		},
		(t) => [
			unique("bulk_row_once").on(t.organizationId, t.jobId, t.row),
			foreignKey({
				columns: [t.organizationId, t.jobId],
				foreignColumns: [bulkJobs.organizationId, bulkJobs.id],
			}),
			check("bulk_row_state", sql`state IN ('created','skipped','failed')`),
			...policies(),
		],
	)
	.enableRLS();
