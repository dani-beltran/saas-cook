// Reviewed Drizzle mirror of 0002/0003. SQL additionally owns FORCE RLS, runtime grants and immutable identity triggers.

import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgPolicy,
	pgSchema,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { foundation, user } from "./schema";
export const tenancy = pgSchema("tenancy");

export const organizations = tenancy
	.table(
		"organizations",
		{
			id: uuid().primaryKey().notNull(),
			slug: text().notNull(),
			name: text().notNull(),
			status: text().default("active").notNull(),
			ownershipVersion: integer("ownership_version").default(1).notNull(),
			requireMfa: boolean("require_mfa").default(false).notNull(),
			acceptPasskeyMfa: boolean("accept_passkey_mfa").default(false).notNull(),
			requiredAuthMethod: text("required_auth_method"),
			createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
				.defaultNow()
				.notNull(),
		},
		(table) => [
			unique("organizations_slug_key").on(table.slug),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.id} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.id} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
			check(
				"organizations_slug_check",
				sql`slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'::text`,
			),
			check(
				"organizations_name_check",
				sql`(length(name) >= 1) AND (length(name) <= 120)`,
			),
			check(
				"organizations_status_check",
				sql`status = ANY (ARRAY['active'::text, 'owner_recovery_required'::text, 'suspended'::text])`,
			),
			check(
				"organizations_required_auth_method_check",
				sql`required_auth_method = ANY (ARRAY['passkey'::text, 'sso'::text])`,
			),
		],
	)
	.enableRLS();

export const memberships = tenancy
	.table(
		"memberships",
		{
			id: uuid().primaryKey().notNull(),
			organizationId: uuid("organization_id").notNull(),
			userId: text("user_id").notNull(),
			role: text().notNull(),
			status: text().notNull(),
			billable: boolean().notNull(),
			expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
			createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
				.defaultNow()
				.notNull(),
		},
		(table) => [
			index("memberships_user_status").using(
				"btree",
				table.userId.asc().nullsLast(),
				table.status.asc().nullsLast(),
			),
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "memberships_organization_id_fkey",
			}),
			foreignKey({
				columns: [table.userId],
				foreignColumns: [user.id],
				name: "memberships_user_id_fkey",
			}),
			unique("memberships_organization_id_id_key").on(
				table.organizationId,
				table.id,
			),
			unique("memberships_organization_id_user_id_key").on(
				table.organizationId,
				table.userId,
			),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
			check(
				"memberships_role_check",
				sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'billing'::text])`,
			),
			check(
				"memberships_status_check",
				sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`,
			),
			check("memberships_check", sql`billable = (role <> 'billing'::text)`),
		],
	)
	.enableRLS();

export const seatCapacities = tenancy
	.table(
		"seat_capacities",
		{
			organizationId: uuid("organization_id").primaryKey().notNull(),
			capacity: integer().notNull(),
			occupied: integer().default(0).notNull(),
			policyVersion: integer("policy_version").default(1).notNull(),
			reconciliationRequired: boolean("reconciliation_required")
				.default(false)
				.notNull(),
		},
		(table) => [
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "seat_capacities_organization_id_fkey",
			}),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
			check("seat_capacities_capacity_check", sql`capacity >= 0`),
			check("seat_capacities_occupied_check", sql`occupied >= 0`),
		],
	)
	.enableRLS();

export const invitations = tenancy
	.table(
		"invitations",
		{
			id: uuid().primaryKey().notNull(),
			organizationId: uuid("organization_id").notNull(),
			email: text().notNull(),
			operationKey: text("operation_key").notNull(),
			tokenHash: text("token_hash").notNull(),
			role: text().notNull(),
			inviterMembershipId: uuid("inviter_membership_id").notNull(),
			expiresAt: timestamp("expires_at", {
				withTimezone: true,
				mode: "date",
			}).notNull(),
			status: text().default("pending").notNull(),
			acceptedBy: text("accepted_by"),
			createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
				.defaultNow()
				.notNull(),
		},
		(table) => [
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "invitations_organization_id_fkey",
			}),
			foreignKey({
				columns: [table.acceptedBy],
				foreignColumns: [user.id],
				name: "invitations_accepted_by_fkey",
			}),
			foreignKey({
				columns: [table.organizationId, table.inviterMembershipId],
				foreignColumns: [memberships.organizationId, memberships.id],
				name: "invitations_organization_id_inviter_membership_id_fkey",
			}),
			unique("invitations_organization_id_operation_key_key").on(
				table.organizationId,
				table.operationKey,
			),
			unique("invitations_token_hash_key").on(table.tokenHash),
			unique("invitations_organization_id_id_key").on(
				table.organizationId,
				table.id,
			),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
			check("invitations_email_check", sql`email = lower(email)`),
			check(
				"invitations_role_check",
				sql`role = ANY (ARRAY['admin'::text, 'member'::text, 'billing'::text])`,
			),
			check(
				"invitations_status_check",
				sql`status = ANY (ARRAY['pending'::text, 'accepted'::text, 'canceled'::text])`,
			),
		],
	)
	.enableRLS();

export const ownershipTransfers = tenancy
	.table(
		"ownership_transfers",
		{
			id: uuid().primaryKey().notNull(),
			organizationId: uuid("organization_id").notNull(),
			initiatorMembershipId: uuid("initiator_membership_id").notNull(),
			recipientMembershipId: uuid("recipient_membership_id").notNull(),
			ownershipVersion: integer("ownership_version").notNull(),
			outgoingRole: text("outgoing_role").notNull(),
			expiresAt: timestamp("expires_at", {
				withTimezone: true,
				mode: "date",
			}).notNull(),
			status: text().default("pending").notNull(),
			acceptedAt: timestamp("accepted_at", {
				withTimezone: true,
				mode: "date",
			}),
		},
		(table) => [
			uniqueIndex("transfers_one_pending")
				.using(
					"btree",
					table.organizationId.asc().nullsLast(),
					table.initiatorMembershipId.asc().nullsLast(),
				)
				.where(sql`(status = 'pending'::text)`),
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "ownership_transfers_organization_id_fkey",
			}),
			foreignKey({
				columns: [table.organizationId, table.initiatorMembershipId],
				foreignColumns: [memberships.organizationId, memberships.id],
				name: "ownership_transfers_organization_id_initiator_membership_i_fkey",
			}),
			foreignKey({
				columns: [table.organizationId, table.recipientMembershipId],
				foreignColumns: [memberships.organizationId, memberships.id],
				name: "ownership_transfers_organization_id_recipient_membership_i_fkey",
			}),
			unique("ownership_transfers_organization_id_id_key").on(
				table.organizationId,
				table.id,
			),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
			check(
				"ownership_transfers_outgoing_role_check",
				sql`outgoing_role = ANY (ARRAY['admin'::text, 'member'::text, 'billing'::text, 'inactive'::text])`,
			),
			check(
				"ownership_transfers_status_check",
				sql`status = ANY (ARRAY['pending'::text, 'accepted'::text, 'canceled'::text, 'expired'::text])`,
			),
			check(
				"ownership_transfers_check",
				sql`initiator_membership_id <> recipient_membership_id`,
			),
		],
	)
	.enableRLS();

export const auditEvents = tenancy
	.table(
		"audit_events",
		{
			id: uuid().primaryKey().notNull(),
			organizationId: uuid("organization_id").notNull(),
			actorId: text("actor_id").notNull(),
			action: text().notNull(),
			targetId: text("target_id").notNull(),
			changes: jsonb().notNull(),
			requestId: uuid("request_id"),
			traceId: text("trace_id"),
			occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
				.defaultNow()
				.notNull(),
		},
		(table) => [
			check(
				"audit_events_trace_id_check",
				sql`${table.traceId} IS NULL OR ${table.traceId} ~ '^[0-9a-f]{32}$'`,
			),
			unique("audit_events_organization_id_id_key").on(
				table.organizationId,
				table.id,
			),
			index("audit_timeline").using(
				"btree",
				table.organizationId.asc().nullsLast(),
				table.occurredAt.desc().nullsFirst(),
				table.id.desc().nullsFirst(),
			),
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "audit_events_organization_id_fkey",
			}),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
		],
	)
	.enableRLS();

export const outboxEvents = tenancy
	.table(
		"outbox_events",
		{
			id: uuid().primaryKey().notNull(),
			organizationId: uuid("organization_id").notNull(),
			type: text().notNull(),
			schemaVersion: integer("schema_version").default(1).notNull(),
			payload: jsonb().notNull(),
			createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
				.defaultNow()
				.notNull(),
		},
		(table) => [
			foreignKey({
				columns: [table.organizationId, table.id],
				foreignColumns: [auditEvents.organizationId, auditEvents.id],
				name: "outbox_events_organization_id_id_fkey",
			}),
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "outbox_events_organization_id_fkey",
			}),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
		],
	)
	.enableRLS();

export const ownerRecoveryCases = tenancy
	.table(
		"owner_recovery_cases",
		{
			id: uuid().primaryKey().notNull(),
			organizationId: uuid("organization_id").notNull(),
			operatorId: text("operator_id").notNull(),
			evidenceReference: text("evidence_reference").notNull(),
			replacementUserId: text("replacement_user_id").notNull(),
			outcome: text().notNull(),
			createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
				.defaultNow()
				.notNull(),
		},
		(table) => [
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "owner_recovery_cases_organization_id_fkey",
			}),
			foreignKey({
				columns: [table.replacementUserId],
				foreignColumns: [user.id],
				name: "owner_recovery_cases_replacement_user_id_fkey",
			}),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
			check(
				"owner_recovery_cases_outcome_check",
				sql`outcome = 'completed'::text`,
			),
		],
	)
	.enableRLS();

export const teams = tenancy
	.table(
		"teams",
		{
			id: uuid().primaryKey().notNull(),
			organizationId: uuid("organization_id").notNull(),
			slug: text().notNull(),
			name: text().notNull(),
		},
		(table) => [
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "teams_organization_id_fkey",
			}),
			unique("teams_organization_id_id_key").on(table.organizationId, table.id),
			unique("teams_organization_id_slug_key").on(
				table.organizationId,
				table.slug,
			),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
		],
	)
	.enableRLS();

export const installation = foundation.table(
	"installation",
	{
		singleton: boolean().default(true).primaryKey().notNull(),
		installationId: uuid("installation_id").notNull(),
		bindingId: uuid("binding_id").notNull(),
		recoveryEpoch: uuid("recovery_epoch").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("installation_installation_id_key").on(table.installationId),
		check("installation_singleton_check", sql`singleton`),
	],
);

export const authorizationRevisions = tenancy
	.table(
		"authorization_revisions",
		{
			organizationId: uuid("organization_id").primaryKey().notNull(),
			// You can use { mode: "bigint" } if numbers are exceeding js number limitations
			desiredRevision: bigint("desired_revision", { mode: "number" })
				.default(1)
				.notNull(),
			// You can use { mode: "bigint" } if numbers are exceeding js number limitations
			appliedRevision: bigint("applied_revision", { mode: "number" })
				.default(1)
				.notNull(),
			evaluationMode: text("evaluation_mode")
				.default("contextual-v1")
				.notNull(),
			storeId: text("store_id").notNull(),
			modelId: text("model_id").notNull(),
			modelHash: text("model_hash").notNull(),
			recoveryEpoch: uuid("recovery_epoch").notNull(),
			ready: boolean().default(true).notNull(),
			updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
				.defaultNow()
				.notNull(),
		},
		(table) => [
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "authorization_revisions_organization_id_fkey",
			}),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
			check(
				"authorization_revisions_desired_revision_check",
				sql`desired_revision > 0`,
			),
			check(
				"authorization_revisions_applied_revision_check",
				sql`applied_revision > 0`,
			),
			check(
				"authorization_revisions_evaluation_mode_check",
				sql`evaluation_mode = 'contextual-v1'::text`,
			),
		],
	)
	.enableRLS();

export const teamMembers = tenancy
	.table(
		"team_members",
		{
			organizationId: uuid("organization_id").notNull(),
			teamId: uuid("team_id").notNull(),
			membershipId: uuid("membership_id").notNull(),
		},
		(table) => [
			foreignKey({
				columns: [table.organizationId, table.teamId],
				foreignColumns: [teams.organizationId, teams.id],
				name: "team_members_organization_id_team_id_fkey",
			}),
			foreignKey({
				columns: [table.organizationId, table.membershipId],
				foreignColumns: [memberships.organizationId, memberships.id],
				name: "team_members_organization_id_membership_id_fkey",
			}),
			primaryKey({
				columns: [table.organizationId, table.teamId, table.membershipId],
				name: "team_members_pkey",
			}),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
		],
	)
	.enableRLS();

export const membershipTransitions = tenancy
	.table(
		"membership_transitions",
		{
			organizationId: uuid("organization_id").notNull(),
			operationKey: text("operation_key").notNull(),
			inputHash: text("input_hash").notNull(),
			membershipId: uuid("membership_id").notNull(),
			delta: integer().notNull(),
			createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
				.defaultNow()
				.notNull(),
		},
		(table) => [
			foreignKey({
				columns: [table.organizationId],
				foreignColumns: [organizations.id],
				name: "membership_transitions_organization_id_fkey",
			}),
			foreignKey({
				columns: [table.organizationId, table.membershipId],
				foreignColumns: [memberships.organizationId, memberships.id],
				name: "membership_transitions_organization_id_membership_id_fkey",
			}),
			primaryKey({
				columns: [table.organizationId, table.operationKey],
				name: "membership_transitions_pkey",
			}),
			pgPolicy("migration_control", {
				as: "permissive",
				for: "all",
				to: ["saas_cook_migrator"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("tenant_isolation", {
				as: "permissive",
				for: "all",
				to: ["public"],
				using: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
				withCheck: sql`${table.organizationId} = nullif(current_setting('app.organization_id',true),'')::uuid`,
			}),
		],
	)
	.enableRLS();
