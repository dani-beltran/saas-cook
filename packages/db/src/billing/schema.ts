// Reviewed Phase 5 schema. Additional SQL owns immutable history, role grants and routing functions.
import { sql } from "drizzle-orm";
import {
	bigint,
	bigserial,
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
import { organizations, tenancy } from "../tenancy-schema";

const time = (name: string) =>
	timestamp(name, { withTimezone: true, precision: 3 });
const tenant = () =>
	uuid("organization_id")
		.notNull()
		.references(() => organizations.id);
const policies = () => [
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
];
export const planVersions = foundation.table(
	"plan_versions",
	{
		id: text().primaryKey(),
		planKey: text("plan_key").notNull(),
		version: integer().notNull(),
		definition: jsonb().notNull(),
		createdAt: time("created_at").notNull().defaultNow(),
	},
	(t) => [
		unique("plan_version_key").on(t.planKey, t.version),
		check("plan_version_positive", sql`version > 0`),
	],
);
export const billingPrices = foundation.table(
	"billing_prices",
	{
		environment: text().notNull(),
		priceId: text("price_id").notNull(),
		planVersionId: text("plan_version_id")
			.notNull()
			.references(() => planVersions.id),
		currency: text().notNull(),
		amount: integer().notNull(),
		interval: text().notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.environment, t.priceId] }),
		unique("billing_price_plan").on(t.environment, t.planVersionId),
		check(
			"billing_price_values",
			sql`amount >= 0 AND currency ~ '^[a-z]{3}$' AND interval IN ('month','year')`,
		),
	],
);
export const billingAccounts = tenancy
	.table(
		"billing_accounts",
		{
			organizationId: tenant().primaryKey(),
			environment: text().notNull(),
			customerId: text("customer_id"),
			subscriptionId: text("subscription_id"),
			planVersionId: text("plan_version_id").references(() => planVersions.id),
			providerStatus: text("provider_status").notNull().default("none"),
			accessState: text("access_state").notNull().default("free"),
			quantity: integer().notNull().default(0),
			periodStart: time("period_start"),
			periodEnd: time("period_end"),
			trialEnd: time("trial_end"),
			cancelAt: time("cancel_at"),
			graceEnd: time("grace_end"),
			validUntil: time("valid_until"),
			sourceVersion: integer("source_version").notNull().default(1),
			fingerprint: text().notNull().default(""),
			health: text().notNull().default("pending"),
			reconciledAt: time("reconciled_at"),
			nextReconcileAt: time("next_reconcile_at").notNull().defaultNow(),
			features: jsonb().notNull().default({}),
			scheduled: jsonb(),
			locale: text().notNull().default("en"),
		},
		(t) => [
			unique("billing_customer_mapping").on(t.environment, t.customerId),
			unique("billing_subscription_mapping").on(
				t.environment,
				t.subscriptionId,
			),
			check("billing_quantity", sql`quantity BETWEEN 0 AND 100000`),
			check(
				"billing_health",
				sql`health IN ('pending','healthy','outage','review')`,
			),
			check(
				"billing_access",
				sql`access_state IN ('free','trial','pending','active','grace','restricted','canceled')`,
			),
			check("billing_locale", sql`locale IN ('en','es')`),
			...policies(),
		],
	)
	.enableRLS();
export const billingCommands = tenancy
	.table(
		"billing_commands",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			actorId: text("actor_id").notNull(),
			operationKey: text("operation_key").notNull(),
			inputHash: text("input_hash").notNull(),
			kind: text().notNull(),
			input: jsonb().notNull(),
			authorization: jsonb().notNull(),
			authorizedUntil: time("authorized_until").notNull(),
			state: text().notNull().default("pending"),
			attempts: integer().notNull().default(0),
			firstAttemptAt: time("first_attempt_at"),
			availableAt: time("available_at").notNull().defaultNow(),
			result: jsonb(),
			errorCode: text("error_code"),
			createdAt: time("created_at").notNull().defaultNow(),
		},
		(t) => [
			unique("billing_command_operation").on(
				t.organizationId,
				t.actorId,
				t.operationKey,
			),
			unique("billing_command_org_id").on(t.organizationId, t.id),
			check(
				"billing_command_kind",
				sql`kind IN ('checkout','change','cancel','portal')`,
			),
			check(
				"billing_command_state",
				sql`state IN ('pending','submitted','complete','failed','review')`,
			),
			index("billing_commands_pending").on(t.organizationId, t.availableAt),
			...policies(),
		],
	)
	.enableRLS();
export const billingPreviews = tenancy
	.table(
		"billing_previews",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			actorId: text("actor_id").notNull(),
			input: jsonb().notNull(),
			sourceVersion: integer("source_version").notNull(),
			amount: integer().notNull(),
			currency: text().notNull(),
			effectiveAt: time("effective_at").notNull(),
			expiresAt: time("expires_at").notNull(),
			prorationDate: integer("proration_date").notNull(),
		},
		(t) => [
			unique("billing_preview_org_id").on(t.organizationId, t.id),
			...policies(),
		],
	)
	.enableRLS();
export const billingInvoices = tenancy
	.table(
		"billing_invoices",
		{
			organizationId: tenant(),
			id: text().notNull(),
			currency: text().notNull(),
			amountDue: integer("amount_due").notNull(),
			amountPaid: integer("amount_paid").notNull(),
			status: text().notNull(),
			hostedUrl: text("hosted_url"),
			periodStart: time("period_start").notNull(),
			periodEnd: time("period_end").notNull(),
		},
		(t) => [primaryKey({ columns: [t.organizationId, t.id] }), ...policies()],
	)
	.enableRLS();
export const billingInbox = foundation.table(
	"billing_inbox",
	{
		environment: text().notNull(),
		eventId: text("event_id").notNull(),
		type: text().notNull(),
		customerId: text("customer_id"),
		apiVersion: text("api_version"),
		digest: text().notNull(),
		state: text().notNull(),
		receivedAt: time("received_at").notNull().defaultNow(),
		processedAt: time("processed_at"),
		reason: text(),
	},
	(t) => [
		primaryKey({ columns: [t.environment, t.eventId] }),
		index("billing_inbox_pending").on(t.state, t.receivedAt),
		check(
			"billing_inbox_state",
			sql`state IN ('pending','processed','quarantined','ignored')`,
		),
	],
);
export const billingReconciliations = tenancy
	.table(
		"billing_reconciliations",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			sourceVersion: integer("source_version").notNull(),
			outcome: text().notNull(),
			occurredAt: time("occurred_at").notNull().defaultNow(),
		},
		(t) => [
			index("billing_reconciliations_org").on(t.organizationId, t.occurredAt),
			...policies(),
		],
	)
	.enableRLS();
export const quotaBuckets = tenancy
	.table(
		"quota_buckets",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			metric: text().notNull(),
			metricVersion: integer("metric_version").notNull().default(1),
			periodStart: time("period_start").notNull(),
			periodEnd: time("period_end").notNull(),
			consumed: integer().notNull().default(0),
			reserved: integer().notNull().default(0),
			watermark: bigint({ mode: "number" }).notNull().default(0),
			aggregateVersion: integer("aggregate_version").notNull().default(1),
			policyKind: text("policy_kind").notNull(),
			capacity: integer(),
		},
		(t) => [
			unique("quota_window").on(
				t.organizationId,
				t.metric,
				t.metricVersion,
				t.periodStart,
			),
			unique("quota_bucket_org_id").on(t.organizationId, t.id),
			check(
				"quota_values",
				sql`consumed>=0 AND reserved>=0 AND period_end>period_start AND (capacity IS NULL OR capacity>=0) AND policy_kind IN ('missing','disabled','limited','unlimited')`,
			),
			...policies(),
		],
	)
	.enableRLS();
export const quotaReservations = tenancy
	.table(
		"quota_reservations",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			bucketId: uuid("bucket_id").notNull(),
			metric: text().notNull(),
			operationKey: text("operation_key").notNull(),
			quantity: integer().notNull(),
			state: text().notNull().default("reserved"),
			occurredAt: time("occurred_at").notNull(),
			expiresAt: time("expires_at").notNull(),
		},
		(t) => [
			unique("quota_operation").on(t.organizationId, t.metric, t.operationKey),
			unique("quota_reservation_org_id").on(t.organizationId, t.id),
			foreignKey({
				columns: [t.organizationId, t.bucketId],
				foreignColumns: [quotaBuckets.organizationId, quotaBuckets.id],
			}),
			check(
				"quota_reservation_values",
				sql`quantity>0 AND state IN ('reserved','committed','released','expired')`,
			),
			index("quota_expiry").on(
				t.organizationId,
				t.bucketId,
				t.state,
				t.expiresAt,
			),
			...policies(),
		],
	)
	.enableRLS();
export const usageEvents = tenancy
	.table(
		"usage_events",
		{
			id: uuid().primaryKey(),
			sequence: bigserial({ mode: "number" }).notNull(),
			organizationId: tenant(),
			bucketId: uuid("bucket_id").notNull(),
			metric: text().notNull(),
			metricVersion: integer("metric_version").notNull().default(1),
			operationKey: text("operation_key").notNull(),
			quantity: integer().notNull(),
			occurredAt: time("occurred_at").notNull(),
			receivedAt: time("received_at").notNull().defaultNow(),
			correctionOf: uuid("correction_of"),
			reason: text(),
			dimensions: jsonb().notNull().default({}),
		},
		(t) => [
			unique("usage_event_org_id").on(t.organizationId, t.id),
			unique("usage_event_operation").on(
				t.organizationId,
				t.metric,
				t.operationKey,
			),
			foreignKey({
				columns: [t.organizationId, t.bucketId],
				foreignColumns: [quotaBuckets.organizationId, quotaBuckets.id],
			}),
			foreignKey({
				columns: [t.organizationId, t.correctionOf],
				foreignColumns: [t.organizationId, t.id],
			}),
			check(
				"usage_event_quantity",
				sql`quantity<>0 AND (quantity>0 OR correction_of IS NOT NULL) AND dimensions='{}'::jsonb AND metric='projects.created' AND metric_version=1`,
			),
			index("usage_rebuild").on(t.organizationId, t.bucketId, t.sequence),
			...policies(),
		],
	)
	.enableRLS();
export const billingNotices = tenancy
	.table(
		"billing_notices",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			noticeKey: text("notice_key").notNull(),
			kind: text().notNull(),
			payload: jsonb().notNull(),
			createdAt: time("created_at").notNull().defaultNow(),
			dispatchedAt: time("dispatched_at"),
			expiresAt: time("expires_at").notNull(),
		},
		(t) => [
			unique("billing_notice_key").on(t.organizationId, t.noticeKey),
			unique("billing_notice_org_id").on(t.organizationId, t.id),
			...policies(),
		],
	)
	.enableRLS();
export const billingDeliveries = tenancy
	.table(
		"billing_deliveries",
		{
			id: uuid().primaryKey(),
			organizationId: tenant(),
			noticeId: uuid("notice_id").notNull(),
			userId: text("user_id").notNull(),
			encryptedPayload: text("encrypted_payload").notNull(),
			state: text().notNull().default("pending"),
			attempts: integer().notNull().default(0),
			availableAt: time("available_at").notNull().defaultNow(),
			expiresAt: time("expires_at").notNull(),
		},
		(t) => [
			unique("billing_delivery_recipient").on(
				t.organizationId,
				t.noticeId,
				t.userId,
			),
			foreignKey({
				columns: [t.organizationId, t.noticeId],
				foreignColumns: [billingNotices.organizationId, billingNotices.id],
			}),
			check(
				"billing_delivery_state",
				sql`state IN ('pending','delivered','failed','expired','revoked')`,
			),
			...policies(),
		],
	)
	.enableRLS();
