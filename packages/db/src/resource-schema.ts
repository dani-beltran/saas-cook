// Reviewed Phase 3 schema; SQL migration additionally forces RLS and restricts runtime privileges.
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgPolicy,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { memberships, organizations, teams, tenancy } from "./tenancy-schema";

const dates = () => ({
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});
const policies = () => [
	pgPolicy("migration_control", {
		for: "all",
		to: ["common_saas_migrator"],
		using: sql`true`,
		withCheck: sql`true`,
	}),
	pgPolicy("tenant_isolation", {
		for: "all",
		to: ["public"],
		using: sql`organization_id = nullif(current_setting('app.organization_id',true),'')::uuid`,
		withCheck: sql`organization_id = nullif(current_setting('app.organization_id',true),'')::uuid`,
	}),
];
export const serviceAccounts = tenancy
	.table(
		"service_accounts",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			name: text().notNull(),
			status: text().notNull().default("active"),
			capabilities: text().array().notNull().default(sql`'{}'::text[]`),
			version: integer().notNull().default(1),
			...dates(),
		},
		(t) => [
			unique("service_accounts_org_id").on(t.organizationId, t.id),
			check("service_accounts_name", sql`length(name) BETWEEN 1 AND 120`),
			check("service_accounts_status", sql`status IN ('active','inactive')`),
			...policies(),
		],
	)
	.enableRLS();
export const apiKeys = tenancy
	.table(
		"api_keys",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			serviceAccountId: uuid("service_account_id").notNull(),
			prefix: text().notNull(),
			secretHash: text("secret_hash").notNull().unique(),
			scopes: text().array().notNull(),
			expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
			revokedAt: timestamp("revoked_at", { withTimezone: true }),
			recoveryEpoch: uuid("recovery_epoch").notNull(),
			createdAt: timestamp("created_at", { withTimezone: true })
				.defaultNow()
				.notNull(),
			lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		},
		(t) => [
			unique("api_keys_org_id").on(t.organizationId, t.id),
			foreignKey({
				columns: [t.organizationId, t.serviceAccountId],
				foreignColumns: [serviceAccounts.organizationId, serviceAccounts.id],
			}),
			index("api_keys_service").on(t.organizationId, t.serviceAccountId),
			check("api_keys_hash", sql`secret_hash ~ '^[0-9a-f]{64}$'`),
			check("api_keys_expiry", sql`expires_at > created_at`),
			...policies(),
		],
	)
	.enableRLS();
export const resourceRegistry = tenancy
	.table(
		"resource_registry",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			resourceType: text("resource_type").notNull(),
			deletedAt: timestamp("deleted_at", { withTimezone: true }),
		},
		(t) => [
			unique("resource_registry_org_id").on(t.organizationId, t.id),
			check("resource_registry_type", sql`resource_type = 'project'`),
			...policies(),
		],
	)
	.enableRLS();
export const projects = tenancy
	.table(
		"projects",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			name: text().notNull(),
			slug: text().notNull(),
			description: text().notNull().default(""),
			status: text().notNull().default("active"),
			ownerMembershipId: uuid("owner_membership_id"),
			version: integer().notNull().default(1),
			deletedAt: timestamp("deleted_at", { withTimezone: true }),
			...dates(),
		},
		(t) => [
			unique("projects_org_id").on(t.organizationId, t.id),
			unique("projects_org_slug").on(t.organizationId, t.slug),
			foreignKey({
				columns: [t.organizationId, t.id],
				foreignColumns: [resourceRegistry.organizationId, resourceRegistry.id],
			}),
			foreignKey({
				columns: [t.organizationId, t.ownerMembershipId],
				foreignColumns: [memberships.organizationId, memberships.id],
			}),
			index("projects_list").on(
				t.organizationId,
				t.createdAt.desc(),
				t.id.desc(),
			),
			check("projects_name", sql`length(name) BETWEEN 1 AND 120`),
			check("projects_description", sql`length(description)<=4000`),
			check("projects_slug", sql`slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'`),
			check(
				"projects_status",
				sql`status IN ('active','completed','archived')`,
			),
			check("projects_version", sql`version > 0`),
			...policies(),
		],
	)
	.enableRLS();
export const resourceGrants = tenancy
	.table(
		"resource_grants",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			resourceId: uuid("resource_id").notNull(),
			relation: text().notNull(),
			membershipId: uuid("membership_id"),
			teamId: uuid("team_id"),
			serviceAccountId: uuid("service_account_id"),
			expiresAt: timestamp("expires_at", { withTimezone: true }),
			createdAt: timestamp("created_at", { withTimezone: true })
				.defaultNow()
				.notNull(),
		},
		(t) => [
			unique("resource_grants_org_id").on(t.organizationId, t.id),
			foreignKey({
				columns: [t.organizationId, t.resourceId],
				foreignColumns: [resourceRegistry.organizationId, resourceRegistry.id],
			}),
			foreignKey({
				columns: [t.organizationId, t.membershipId],
				foreignColumns: [memberships.organizationId, memberships.id],
			}),
			foreignKey({
				columns: [t.organizationId, t.teamId],
				foreignColumns: [teams.organizationId, teams.id],
			}).onDelete("cascade"),
			foreignKey({
				columns: [t.organizationId, t.serviceAccountId],
				foreignColumns: [serviceAccounts.organizationId, serviceAccounts.id],
			}),
			index("resource_grants_target").on(t.organizationId, t.resourceId),
			index("resource_grants_member").on(
				t.organizationId,
				t.membershipId,
				t.resourceId,
			),
			check(
				"resource_grants_subject",
				sql`num_nonnulls(membership_id,team_id,service_account_id)=1`,
			),
			check(
				"resource_grants_relation",
				sql`relation IN ('viewer','editor','manager','denied')`,
			),
			...policies(),
		],
	)
	.enableRLS();
export const resourceOperations = tenancy
	.table(
		"resource_operations",
		{
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			actorId: text("actor_id").notNull(),
			operation: text().notNull(),
			operationKey: text("operation_key").notNull(),
			inputHash: text("input_hash").notNull(),
			resourceId: uuid("resource_id").notNull(),
			createdAt: timestamp("created_at", { withTimezone: true })
				.defaultNow()
				.notNull(),
		},
		(t) => [
			primaryKey({
				columns: [t.organizationId, t.actorId, t.operation, t.operationKey],
			}),
			...policies(),
		],
	)
	.enableRLS();
export const capacityBuckets = tenancy
	.table(
		"capacity_buckets",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			feature: text().notNull(),
			policyKind: text("policy_kind").notNull(),
			capacity: integer(),
			consumed: integer().notNull().default(0),
			reserved: integer().notNull().default(0),
			policyVersion: integer("policy_version").notNull().default(1),
		},
		(t) => [
			unique("capacity_buckets_org_id").on(t.organizationId, t.id),
			unique("capacity_buckets_feature").on(t.organizationId, t.feature),
			check(
				"capacity_buckets_counts",
				sql`consumed>=0 AND reserved>=0 AND policy_version>0`,
			),
			check(
				"capacity_buckets_policy",
				sql`(policy_kind='limited' AND capacity>=0) OR (policy_kind IN ('missing','disabled','unlimited') AND capacity IS NULL)`,
			),
			...policies(),
		],
	)
	.enableRLS();
export const capacityReservations = tenancy
	.table(
		"capacity_reservations",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			bucketId: uuid("bucket_id").notNull(),
			operationKey: text("operation_key").notNull(),
			quantity: integer().notNull(),
			state: text().notNull().default("reserved"),
			expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
			createdAt: timestamp("created_at", { withTimezone: true })
				.defaultNow()
				.notNull(),
		},
		(t) => [
			unique("capacity_reservations_operation").on(
				t.organizationId,
				t.bucketId,
				t.operationKey,
			),
			foreignKey({
				columns: [t.organizationId, t.bucketId],
				foreignColumns: [capacityBuckets.organizationId, capacityBuckets.id],
			}),
			index("capacity_reservations_expiry").on(
				t.organizationId,
				t.bucketId,
				t.expiresAt,
			),
			check("capacity_reservations_quantity", sql`quantity>0`),
			check(
				"capacity_reservations_state",
				sql`state IN ('reserved','committed','released','expired')`,
			),
			...policies(),
		],
	)
	.enableRLS();
