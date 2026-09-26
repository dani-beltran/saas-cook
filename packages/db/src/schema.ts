import { boolean, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const foundation = pgSchema("foundation");
export const runtimeHeartbeats = foundation.table("runtime_heartbeats", {
	process: text("process").primaryKey(),
	observedAt: timestamp("observed_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
// Identity tables have their own runtime credential. No public authentication
// endpoints are mounted until the Phase 2 lifecycle and assurance boundary ships.
export const identity = pgSchema("identity");
const dates = () => ({
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
export const user = identity.table("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	...dates(),
});
export const session = identity.table("session", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id),
	token: text("token").notNull().unique(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
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
export const verification = identity.table("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	...dates(),
});
export const identitySchema = { user, session, account, verification };

export const runtimeProbes = foundation.table("runtime_probes", {
	id: uuid("id").primaryKey(),
	processedAt: timestamp("processed_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
