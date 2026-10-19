import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgPolicy,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { foundation } from "../schema";
import { memberships, organizations, tenancy } from "../tenancy-schema";

const time = (n: string) => timestamp(n, { withTimezone: true });
const tenant = () =>
	uuid("organization_id")
		.notNull()
		.references(() => organizations.id);
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
export const notificationPreferences = foundation.table(
	"notification_preferences",
	{
		userId: text("user_id").primaryKey(),
		email: boolean().notNull().default(false),
		inApp: boolean("in_app").notNull().default(true),
		locale: text().notNull().default("en"),
		emailSuppressed: boolean("email_suppressed").notNull().default(false),
		version: integer().notNull().default(1),
	},
	() => [check("notification_locale", sql`locale IN ('en','es')`)],
);
export const notifications = tenancy
	.table(
		"notifications",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			userId: text("user_id").notNull(),
			sourceId: uuid("source_id").notNull(),
			kind: text().notNull(),
			referenceId: uuid("reference_id").notNull(),
			readAt: time("read_at"),
			emailState: text("email_state").notNull().default("pending"),
			attempts: integer().notNull().default(0),
			availableAt: time("available_at").notNull().defaultNow(),
			expiresAt: time("expires_at").notNull(),
			createdAt: time("created_at").notNull().defaultNow(),
		},
		(t) => [
			unique("notification_source").on(t.organizationId, t.userId, t.sourceId),
			check("notification_kind", sql`kind IN ('bulk.completed')`),
			check(
				"notification_email_state",
				sql`email_state IN ('pending','delivered','skipped','failed')`,
			),
			...policies(),
		],
	)
	.enableRLS();
export const webhookEndpoints = tenancy
	.table(
		"webhook_endpoints",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			name: text().notNull(),
			url: text().notNull(),
			events: jsonb().$type<string[]>().notNull(),
			secret: text(),
			previousSecret: text("previous_secret"),
			previousUntil: time("previous_until"),
			state: text().notNull().default("unverified"),
			version: integer().notNull().default(1),
			createdAt: time("created_at").notNull().defaultNow(),
		},
		(t) => [
			unique("webhook_org_id").on(t.organizationId, t.id),
			check("webhook_state", sql`state IN ('unverified','active','revoked')`),
			...policies(),
		],
	)
	.enableRLS();
export const webhookDeliveries = tenancy
	.table(
		"webhook_deliveries",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			endpointId: uuid("endpoint_id").notNull(),
			sourceId: uuid("source_id").notNull(),
			event: text().notNull(),
			targetId: uuid("target_id").notNull(),
			occurredAt: time("occurred_at").notNull(),
			state: text().notNull().default("pending"),
			attempts: integer().notNull().default(0),
			availableAt: time("available_at").notNull().defaultNow(),
			lastStatus: integer("last_status"),
		},
		(t) => [
			unique("webhook_delivery_once").on(
				t.organizationId,
				t.endpointId,
				t.sourceId,
			),
			foreignKey({
				columns: [t.organizationId, t.endpointId],
				foreignColumns: [webhookEndpoints.organizationId, webhookEndpoints.id],
			}),
			check(
				"webhook_delivery_state",
				sql`state IN ('pending','delivered','failed','canceled')`,
			),
			index("webhook_delivery_due").on(t.state, t.availableAt),
			...policies(),
		],
	)
	.enableRLS();
export const integrationConnections = tenancy
	.table(
		"integration_connections",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			name: text().notNull(),
			provider: text().notNull().default("https-api"),
			url: text().notNull(),
			secret: text(),
			scopes: jsonb().$type<string[]>().notNull(),
			state: text().notNull().default("unverified"),
			version: integer().notNull().default(1),
			checkedAt: time("checked_at"),
		},
		() => [
			check(
				"integration_state",
				sql`state IN ('unverified','active','unhealthy','revoked')`,
			),
			check("integration_provider", sql`provider='https-api'`),
			...policies(),
		],
	)
	.enableRLS();
export const auditAccess = tenancy
	.table(
		"audit_access",
		{
			organizationId: tenant(),
			membershipId: uuid("membership_id").notNull(),
			enabled: boolean().notNull(),
			version: integer().notNull().default(1),
		},
		(t) => [
			primaryKey({ columns: [t.organizationId, t.membershipId] }),
			foreignKey({
				columns: [t.organizationId, t.membershipId],
				foreignColumns: [memberships.organizationId, memberships.id],
			}),
			...policies(),
		],
	)
	.enableRLS();
export const rolloutFlags = foundation.table(
	"rollout_flags",
	{
		key: text().primaryKey(),
		owner: text().notNull(),
		enabled: boolean().notNull(),
		percent: integer().notNull(),
		organizations: jsonb().$type<string[]>().notNull().default([]),
		excluded: jsonb().$type<string[]>().notNull().default([]),
		environment: text().notNull(),
		expiresAt: time("expires_at").notNull(),
		version: integer().notNull(),
	},
	() => [check("rollout_percent", sql`percent BETWEEN 0 AND 100`)],
);
export const rolloutHistory = foundation.table(
	"rollout_history",
	{
		id: uuid().primaryKey(),
		key: text().notNull(),
		version: integer().notNull(),
		configuration: jsonb().notNull(),
		createdAt: time("created_at").notNull().defaultNow(),
	},
	(t) => [unique("rollout_history_version").on(t.key, t.version)],
);
export const settingsOperations = tenancy
	.table(
		"settings_operations",
		{
			organizationId: tenant(),
			actorId: text("actor_id").notNull(),
			operationKey: text("operation_key").notNull(),
			inputHash: text("input_hash").notNull(),
			result: jsonb().notNull(),
		},
		(t) => [
			primaryKey({ columns: [t.organizationId, t.actorId, t.operationKey] }),
			...policies(),
		],
	)
	.enableRLS();
