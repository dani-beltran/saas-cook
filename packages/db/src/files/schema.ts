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
import { capacityReservations, projects } from "../resource-schema";
import { organizations, tenancy } from "../tenancy-schema";
export const files = tenancy
	.table(
		"files",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			projectId: uuid("project_id").notNull(),
			requesterId: text("requester_id").notNull(),
			operationKey: text("operation_key").notNull(),
			name: text().notNull(),
			contentType: text("content_type").notNull(),
			bytes: integer().notNull(),
			sha256: text().notNull(),
			reservationId: uuid("reservation_id").notNull(),
			state: text().notNull().default("staging"),
			object: jsonb().$type<{
				key: string;
				version: string;
				bytes: number;
				sha256: string;
				scan: { engine: string; verdict: "clean" | "rejected" };
			}>(),
			createdAt: timestamp("created_at", { withTimezone: true })
				.notNull()
				.defaultNow(),
			expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		},
		(t) => [
			unique("file_org_id").on(t.organizationId, t.id),
			unique("file_operation").on(
				t.organizationId,
				t.requesterId,
				t.operationKey,
			),
			foreignKey({
				columns: [t.organizationId, t.projectId],
				foreignColumns: [projects.organizationId, projects.id],
			}),
			foreignKey({
				columns: [t.organizationId, t.reservationId],
				foreignColumns: [
					capacityReservations.organizationId,
					capacityReservations.id,
				],
			}),
			check(
				"file_state",
				sql`state IN ('staging','available','rejected','deleted')`,
			),
			check("file_bytes", sql`bytes BETWEEN 1 AND 1048576`),
			check(
				"file_content_type",
				sql`content_type IN ('text/plain','text/csv')`,
			),
			check(
				"file_available_identity",
				sql`state<>'available' OR object IS NOT NULL`,
			),
			index("file_expiry").on(t.expiresAt, t.organizationId),
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
