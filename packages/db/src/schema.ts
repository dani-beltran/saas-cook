import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	pgSchema,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export const foundation = pgSchema("foundation");
export const runtimeHeartbeats = foundation.table("runtime_heartbeats", {
	process: text("process").primaryKey(),
	observedAt: timestamp("observed_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
// Identity tables have a dedicated credential; application roles use reviewed lookup functions.
export const identity = pgSchema("identity");
const dates = () => ({
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
export const user = identity.table(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull().unique(),
		emailVerified: boolean("email_verified").notNull().default(false),
		image: text("image"),
		twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
		lifecycleStatus: text("lifecycle_status").notNull().default("active"),
		credentialEpoch: bigint("credential_epoch", { mode: "number" })
			.notNull()
			.default(1),
		...dates(),
	},
	(table) => [
		check(
			"user_lifecycle_status_check",
			sql`${table.lifecycleStatus} IN ('active','frozen','deleted')`,
		),
		check("user_credential_epoch_check", sql`${table.credentialEpoch}>0`),
	],
);
export const session = identity.table("session", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id),
	token: text("token").notNull().unique(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	authenticationMethod: text("authentication_method")
		.notNull()
		.default("unknown"),
	authenticatedAt: timestamp("authenticated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	userVerified: boolean("user_verified").notNull().default(false),
	mfa: boolean("mfa").notNull().default(false),
	credentialEpoch: bigint("credential_epoch", { mode: "number" })
		.notNull()
		.default(1),
	recoveryEpoch: text("recovery_epoch").notNull().default("uninitialized"),
	...dates(),
});
export const account = identity.table("account", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", {
		withTimezone: true,
	}),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
		withTimezone: true,
	}),
	scope: text("scope"),
	password: text("password"),
	...dates(),
});
export const verification = identity.table(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		...dates(),
	},
	(table) => [index("identity_verification_identifier").on(table.identifier)],
);
export const passkey = identity.table(
	"passkey",
	{
		id: text("id").primaryKey(),
		name: text("name"),
		publicKey: text("public_key").notNull(),
		userId: text("user_id").notNull(),
		credentialID: text("credential_id")
			.notNull()
			.unique("passkey_credential_id_key"),
		counter: integer("counter").notNull(),
		deviceType: text("device_type").notNull(),
		backedUp: boolean("backed_up").notNull(),
		transports: text("transports"),
		createdAt: timestamp("created_at", { withTimezone: true }),
		aaguid: text("aaguid"),
	},
	(table) => [
		foreignKey({
			name: "passkey_user_id_fkey",
			columns: [table.userId],
			foreignColumns: [user.id],
		}),
	],
);
export const twoFactor = identity.table(
	"two_factor",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull().unique("two_factor_user_id_key"),
		secret: text("secret").notNull(),
		backupCodes: text("backup_codes").notNull(),
		verified: boolean("verified").notNull().default(false),
		failedVerificationCount: integer("failed_verification_count")
			.notNull()
			.default(0),
		lockedUntil: timestamp("locked_until", { withTimezone: true }),
	},
	(table) => [
		foreignKey({
			name: "two_factor_user_id_fkey",
			columns: [table.userId],
			foreignColumns: [user.id],
		}),
	],
);
export const rateLimit = identity.table("rate_limit", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique("rate_limit_key_key"),
	count: integer("count").notNull(),
	lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
export const ingressLimit = identity.table("ingress_limit", {
	key: text("key").primaryKey(),
	windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
	count: integer("count").notNull(),
});
export const securityAudit = identity.table(
	"security_audit",
	{
		id: uuid("id").primaryKey(),
		userId: text("user_id").notNull(),
		action: text("action").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "security_audit_user_id_fkey",
			columns: [table.userId],
			foreignColumns: [user.id],
		}),
	],
);
export const emailDelivery = identity.table(
	"email_delivery",
	{
		id: uuid("id").primaryKey(),
		encryptedPayload: text("encrypted_payload").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		availableAt: timestamp("available_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		attempts: integer("attempts").notNull().default(0),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
		failedAt: timestamp("failed_at", { withTimezone: true }),
	},
	(table) => [
		index("identity_email_pending")
			.on(table.availableAt)
			.where(sql`${table.deliveredAt} IS NULL AND ${table.failedAt} IS NULL`),
	],
);

export const identitySchema = {
	user,
	session,
	account,
	verification,
	passkey,
	twoFactor,
	rateLimit,
};

export const runtimeProbes = foundation.table("runtime_probes", {
	id: uuid("id").primaryKey(),
	processedAt: timestamp("processed_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
