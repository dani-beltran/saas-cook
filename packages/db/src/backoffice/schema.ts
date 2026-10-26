import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgPolicy,
	pgSchema,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

const identity = pgSchema("operator_identity");
const bo = pgSchema("backoffice");
const date = (name: string) => timestamp(name, { withTimezone: true });
const dates = () => ({
	createdAt: date("created_at").notNull().defaultNow(),
	updatedAt: date("updated_at").notNull().defaultNow(),
});
export const operatorUser = identity.table(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull().unique(),
		emailVerified: boolean("email_verified").notNull().default(true),
		image: text("image"),
		...dates(),
		epoch: uuid("epoch").notNull(),
		status: text("status").notNull().default("invited"),
	},
	(t) => [
		check(
			"operator_status",
			sql`${t.status} IN ('invited','active','disabled')`,
		),
	],
);
export const operatorSession = identity.table("session", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => operatorUser.id),
	token: text("token").notNull().unique(),
	expiresAt: date("expires_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	...dates(),
	epoch: uuid("epoch").notNull(),
	verified: boolean("verified").notNull().default(false),
	lastSeenAt: date("last_seen_at").notNull().defaultNow(),
});
export const operatorAccount = identity.table("account", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => operatorUser.id),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: date("access_token_expires_at"),
	refreshTokenExpiresAt: date("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	...dates(),
});
export const operatorVerification = identity.table(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: date("expires_at").notNull(),
		...dates(),
	},
	(t) => [index("operator_verification_identifier").on(t.identifier)],
);
export const operatorPasskey = identity.table("passkey", {
	id: text("id").primaryKey(),
	name: text("name"),
	publicKey: text("public_key").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => operatorUser.id),
	credentialID: text("credential_id").notNull().unique(),
	counter: integer("counter").notNull(),
	deviceType: text("device_type").notNull(),
	backedUp: boolean("backed_up").notNull(),
	transports: text("transports"),
	createdAt: date("created_at"),
	aaguid: text("aaguid"),
});
export const operatorInvitation = bo.table("invitations", {
	id: uuid("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => operatorUser.id),
	digest: text("digest").notNull().unique(),
	epoch: uuid("epoch").notNull(),
	expiresAt: date("expires_at").notNull(),
	consumedAt: date("consumed_at"),
});
export const operatorGrant = bo
	.table(
		"grants",
		{
			id: uuid("id").primaryKey(),
			userId: text("user_id")
				.notNull()
				.references(() => operatorUser.id),
			organizationId: uuid("organization_id").notNull(),
			epoch: uuid("epoch").notNull(),
			environment: text("environment").notNull(),
			expiresAt: date("expires_at").notNull(),
		},
		(t) => [
			index("operator_grant_lookup").on(t.userId, t.organizationId),
			index("operator_directory_scope").on(
				t.userId,
				t.epoch,
				t.environment,
				t.organizationId,
				t.id,
			),
			pgPolicy("operator_management", {
				for: "all",
				to: ["saas_cook_migrator", "saas_cook_bo_manager"],
				using: sql`true`,
				withCheck: sql`true`,
			}),
			pgPolicy("operator_scope", {
				for: "select",
				to: ["saas_cook_bo_query"],
				using: sql`(${t.organizationId}::text = current_setting('backoffice.organization_id', true) OR current_setting('backoffice.directory', true) = 'on') AND ${t.userId} = current_setting('backoffice.operator_id', true) AND ${t.epoch}::text = current_setting('backoffice.epoch', true) AND ${t.environment} = current_setting('backoffice.environment', true)`,
			}),
		],
	)
	.enableRLS();
export const operatorAudit = bo.table(
	"audit_events",
	{
		id: uuid("id").primaryKey(),
		actorId: text("actor_id"),
		action: text("action").notNull(),
		targetId: uuid("target_id"),
		caseReference: text("case_reference"),
		outcome: text("outcome").notNull(),
		epoch: uuid("epoch"),
		occurredAt: date("occurred_at").notNull().defaultNow(),
	},
	(t) => [index("operator_audit_time").on(t.occurredAt)],
);
export const operatorManagementReceipt = bo.table("management_receipts", {
	nonce: uuid("nonce").primaryKey(),
	payloadHash: text("payload_hash").notNull(),
	createdAt: date("created_at").notNull().defaultNow(),
});
export const operatorRateLimit = bo.table("rate_limits", {
	key: text("key").primaryKey(),
	startedAt: date("started_at").notNull(),
	count: integer("count").notNull(),
});
/** Isolated Better Auth adapter mapping; never include customer identity tables. */
export const operatorIdentitySchema = {
	user: operatorUser,
	session: operatorSession,
	account: operatorAccount,
	verification: operatorVerification,
	passkey: operatorPasskey,
};
