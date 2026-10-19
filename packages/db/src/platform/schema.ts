import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	pgPolicy,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { auditEvents, organizations, tenancy } from "../tenancy-schema";

/** Safe customer projection, independent from append-only audit retention. */
export const activityEvents = tenancy
	.table(
		"activity_events",
		{
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			sourceId: uuid("source_id").notNull(),
			resourceType: text("resource_type").notNull(),
			resourceId: uuid("resource_id").notNull(),
			action: text().notNull(),
			actor: text().notNull(),
			occurredAt: timestamp("occurred_at", {
				withTimezone: true,
				precision: 3,
			}).notNull(),
		},
		(t) => [
			primaryKey({ columns: [t.organizationId, t.sourceId] }),
			foreignKey({
				columns: [t.organizationId, t.sourceId],
				foreignColumns: [auditEvents.organizationId, auditEvents.id],
			}),
			check("activity_type", sql`resource_type IN ('project','customer')`),
			check(
				"activity_action",
				sql`action IN ('created','updated','deleted','restored')`,
			),
			check("activity_actor", sql`actor IN ('member','service','system')`),
			index("activity_retention_order").on(
				t.occurredAt,
				t.organizationId,
				t.sourceId,
			),
			index("activity_resource_order").on(
				t.organizationId,
				t.resourceType,
				t.resourceId,
				t.occurredAt,
				t.sourceId,
			),
			pgPolicy("migration_control", {
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				for: "all",
				to: ["public"],
				using: sql`organization_id = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`organization_id = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
		],
	)
	.enableRLS();
