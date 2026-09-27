import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { identitySchema } from "@saas-cook/db/schema";
import { enqueueIdentityEmail } from "@saas-cook/email";
import { logEvent } from "@saas-cook/observability";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { magicLink, twoFactor } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { ingressSource } from "./ingress";
import { createPersonalSettings } from "./personal-settings";

const optionsSchema = z.strictObject({
	secret: z.string().min(32),
	origin: z.url().refine((value) => {
		const url = new URL(value);
		return (
			url.origin === value &&
			(url.protocol === "https:" ||
				(url.protocol === "http:" &&
					["localhost", "127.0.0.1"].includes(url.hostname)))
		);
	}, "Expected a canonical HTTPS origin (HTTP is allowed only for local development)"),
});
export type SessionIdentity = Readonly<{
	userId: string;
	sessionId: string;
	email: string;
	name: string;
	method: string;
	authenticatedAt: Date;
	userVerified: boolean;
	mfa: boolean;
	credentialEpoch: number;
	recoveryEpoch: string;
	twoFactorEnabled: boolean;
}>;
type Readiness = { epoch: string; bindingId: string; installationId: string };
type Ceremony = {
	authenticatedAt?: Date;
	method: "magic-link" | "password" | "passkey" | "totp" | "recovery";
	userVerified: boolean;
	mfa: boolean;
	epoch: string;
	locale: "en" | "es";
	source: string | null;
	route: string;
	kind?: "verification" | "reset";
	database?: PoolClient;
	registration?: {
		userId: string;
		passwordHash: string;
		credentialEpoch: number;
	};
};
const passwordSchema = z.string().min(12).max(128);
const passwordChallengeSchema = z.object({
	userId: z.string(),
	credentialEpoch: z.number(),
	recoveryEpoch: z.string(),
	passwordHash: z.string().optional(),
});
const ceremonies = new AsyncLocalStorage<Ceremony>();
const protectedHeaders = {
	"Cache-Control": "no-store",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
};
export function safeDestination(value: string, origin: string) {
	let decoded = value;
	for (let attempt = 0; attempt < 4; attempt++) {
		if (
			!decoded.startsWith("/") ||
			decoded.startsWith("//") ||
			/[\\\r\n]/.test(decoded)
		)
			throw new Error("Unsafe destination");
		const url = new URL(decoded, origin);
		if (url.origin !== origin) throw new Error("Unsafe destination");
		const next = decodeURIComponent(decoded);
		if (next === decoded)
			return `${new URL(value, origin).pathname}${new URL(value, origin).search}${new URL(value, origin).hash}`;
		decoded = next;
	}
	throw new Error("Unsafe destination");
}
export function requireFreshAssurance(
	session: SessionIdentity,
	options: { mfa?: boolean; now?: Date } = {},
) {
	const age =
		(options.now ?? new Date()).getTime() - session.authenticatedAt.getTime();
	if (age < 0 || age > 300000 || (options.mfa && !session.mfa))
		throw new Error("Fresh permitted authentication required");
}
/** Compatibility constructor: runtime mounting additionally requires independent recovery readiness. */
export function createIdentityAdapter(
	pool: Pool,
	input: z.input<typeof optionsSchema>,
) {
	const options = optionsSchema.parse(input);
	return betterAuth({
		database: drizzleAdapter(drizzle(pool, { schema: identitySchema }), {
			provider: "pg",
			schema: identitySchema,
			transaction: true,
		}),
		baseURL: options.origin,
		trustedOrigins: [options.origin],
		secret: options.secret,
		emailAndPassword: { enabled: false },
		disabledPaths: ["/update-user"],
		user: { deleteUser: { enabled: false } },
		account: { accountLinking: { enabled: false } },
		logger: { disabled: true },
	});
}
export function createIdentityRuntime(
	pool: Pool,
	input: z.input<typeof optionsSchema> & {
		readiness: () => Promise<Readiness>;
		rpName?: string;
		trustedIngressSecret?: string;
	},
) {
	const options = optionsSchema.parse({
		secret: input.secret,
		origin: input.origin,
	});
	const ingressSecret = z
		.string()
		.min(32)
		.optional()
		.parse(input.trustedIngressSecret);
	if (ingressSecret === options.secret)
		throw new Error("Ingress and identity signing secrets must differ");
	const challengeId = (purpose: "registration" | "reset", token: string) =>
		`password-${purpose}:${createHmac("sha256", options.secret).update(`password-${purpose}:v1\0${token}`).digest("hex")}`;
	let nextProviderCleanup = 0;
	function providerRateLimit(database: Pool | PoolClient) {
		return {
			async consume(_key: string, rule: { window: number; max: number }) {
				const ceremony = ceremonies.getStore();
				if (!ceremony) throw new Error("Identity ingress context required");
				const digest = createHmac("sha256", options.secret)
					.update(
						`identity-provider:v1\0${ceremony.source ?? "unattributed"}\0${ceremony.route}`,
					)
					.digest("hex");
				const now = Date.now();
				// A read/create retry aborts an already-open PostgreSQL transaction on
				// duplicate keys. One upsert both admits atomically and stays on its fence.
				const result = await database.query<{
					count: number;
					last_request: string;
				}>(
					`INSERT INTO identity.rate_limit(id,key,count,last_request) VALUES($1,$2,1,$3)
ON CONFLICT(key) DO UPDATE SET
count=CASE WHEN identity.rate_limit.last_request<=$3::bigint-$4::bigint THEN 1 ELSE LEAST(identity.rate_limit.count+1,$5::int+1) END,
last_request=CASE WHEN identity.rate_limit.last_request<=$3::bigint-$4::bigint OR identity.rate_limit.count<$5::int THEN $3::bigint ELSE identity.rate_limit.last_request END
RETURNING count,last_request`,
					[randomUUID(), digest, now, rule.window * 1000, rule.max],
				);
				const row = result.rows[0];
				if (now >= nextProviderCleanup) {
					nextProviderCleanup = now + 60000;
					// Bounded cleanup never waits for another request's limiter row.
					await database.query(
						`DELETE FROM identity.rate_limit WHERE id IN (
SELECT id FROM identity.rate_limit WHERE last_request<$1 ORDER BY last_request FOR UPDATE SKIP LOCKED LIMIT 1000)`,
						[now - Math.max(86400000, rule.window * 1000)],
					);
				}
				return row.count <= rule.max
					? { allowed: true, retryAfter: null }
					: {
							allowed: false,
							retryAfter: Math.max(
								1,
								Math.ceil(
									(Number(row.last_request) + rule.window * 1000 - now) / 1000,
								),
							),
						};
			},
		};
	}
	async function ready() {
		const publication = await input.readiness();
		const local = (
			await pool.query<{
				installation_id: string;
				binding_id: string;
				recovery_epoch: string;
			}>(
				"SELECT installation_id,binding_id,recovery_epoch FROM foundation.installation",
			)
		).rows[0];
		if (
			!local ||
			local.installation_id !== publication.installationId ||
			local.binding_id !== publication.bindingId ||
			local.recovery_epoch !== publication.epoch
		)
			throw new Error("Identity recovery unavailable");
		return publication.epoch;
	}
	const auth = betterAuth({
		database: drizzleAdapter(drizzle(pool, { schema: identitySchema }), {
			provider: "pg",
			schema: identitySchema,
			transaction: true,
		}),
		baseURL: options.origin,
		trustedOrigins: [options.origin],
		advanced: { ipAddress: { ipAddressHeaders: [] } },
		secret: options.secret,
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
			autoSignIn: false,
			minPasswordLength: 12,
			maxPasswordLength: 128,
		},
		user: { deleteUser: { enabled: false } },
		account: { accountLinking: { enabled: false } },
		logger: { disabled: true },
		disabledPaths: [
			"/update-user",
			"/magic-link/verify",
			"/delete-user",
			"/delete-user/callback",
			"/passkey/delete-passkey",
		],
		rateLimit: {
			enabled: true,
			storage: "database",
			window: 60,
			max: 60,
			customStorage: providerRateLimit(pool),
		},
		session: {
			expiresIn: 86400 * 7,
			updateAge: 3600,
			freshAge: 300,
			cookieCache: { enabled: false },
			additionalFields: {
				authenticationMethod: {
					type: "string",
					input: false,
					defaultValue: "unknown",
				},
				authenticatedAt: { type: "date", input: false },
				userVerified: { type: "boolean", input: false, defaultValue: false },
				mfa: { type: "boolean", input: false, defaultValue: false },
				credentialEpoch: { type: "number", input: false, defaultValue: 1 },
				recoveryEpoch: {
					type: "string",
					input: false,
					defaultValue: "uninitialized",
				},
			},
		},
		databaseHooks: {
			session: {
				create: {
					before: async (data) => {
						const ceremony = ceremonies.getStore();
						if (!ceremony)
							throw new APIError("FORBIDDEN", {
								message: "Authentication ceremony required",
							});
						return {
							data: {
								...data,
								authenticationMethod: ceremony.method,
								authenticatedAt: ceremony.authenticatedAt ?? new Date(),
								userVerified: ceremony.userVerified,
								mfa: ceremony.mfa,
								recoveryEpoch: ceremony.epoch,
							},
						};
					},
				},
			},
		},
		plugins: [
			magicLink({
				storeToken: "hashed",
				expiresIn: 300,
				disableSignUp: true,
				sendMagicLink: async ({ email, token }) => {
					const ceremony = ceremonies.getStore();
					const database = ceremony?.database ?? pool;
					if (ceremony?.registration) {
						await database.query(
							"INSERT INTO identity.verification(id,identifier,value,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
							[
								randomUUID(),
								challengeId("registration", token),
								JSON.stringify({
									...ceremony.registration,
									recoveryEpoch: ceremony.epoch,
								}),
							],
						);
					}
					await enqueueIdentityEmail(database, {
						secret: options.secret,
						to: email,
						kind: ceremony?.kind ?? "magic-link",
						locale: ceremony?.locale ?? "en",
						url: `${options.origin}/auth/confirm?token=${encodeURIComponent(token)}&locale=${ceremony?.locale ?? "en"}`,
						expiresAt: new Date(Date.now() + 300000),
					});
				},
			}),
			passkey({
				rpID: new URL(options.origin).hostname,
				rpName: input.rpName ?? "SaaS Cook",
				origin: options.origin,
				authenticatorSelection: { userVerification: "required" },
				registration: {
					afterVerification: async ({ verification }) => {
						if (!verification.registrationInfo?.userVerified)
							throw new APIError("FORBIDDEN", {
								message: "User verification required",
							});
						const context = ceremonies.getStore();
						if (context) {
							context.authenticatedAt = new Date();
							context.method = "passkey";
							context.userVerified = true;
							context.mfa = true;
						}
					},
				},
				authentication: {
					afterVerification: async ({ verification }) => {
						if (!verification.authenticationInfo.userVerified)
							throw new APIError("FORBIDDEN", {
								message: "User verification required",
							});
						const context = ceremonies.getStore();
						if (!context)
							throw new APIError("FORBIDDEN", { message: "Ceremony required" });
						context.authenticatedAt = new Date();
						context.method = "passkey";
						context.userVerified = true;
						context.mfa = true;
					},
				},
			}),
			{
				...twoFactor({
					issuer: input.rpName ?? "SaaS Cook",
					allowPasswordless: true,
					skipVerificationOnEnable: false,
				}),
				// Both password and magic-link logins use our pending session gate.
				// Tenant actors are unavailable until cryptographic factor verification;
				// do not replace that session with the provider's separate 2FA cookie flow.
				hooks: undefined,
			},
		],
	});
	function providerFor(database: PoolClient) {
		return betterAuth({
			...auth.options,
			rateLimit: {
				...auth.options.rateLimit,
				customStorage: providerRateLimit(database),
			},
			database: drizzleAdapter(drizzle(database, { schema: identitySchema }), {
				provider: "pg",
				schema: identitySchema,
				transaction: false,
			}),
		});
	}
	async function issuePasswordReset(email: string, context: Ceremony) {
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const user = (
				await client.query<{ id: string }>(
					'SELECT id FROM identity."user" WHERE email=$1',
					[email],
				)
			).rows[0];
			if (user) {
				await client.query(
					"SELECT pg_advisory_xact_lock(hashtextextended('user:'||$1,0))",
					[user.id],
				);
				const current = (
					await client.query<{ credential_epoch: string }>(
						`SELECT u.credential_epoch FROM identity."user" u WHERE u.id=$1 AND u.lifecycle_status='active' AND u.email_verified
AND EXISTS(SELECT 1 FROM identity.account a WHERE a.user_id=u.id AND a.provider_id='credential' AND a.account_id=u.id AND a.password IS NOT NULL)`,
						[user.id],
					)
				).rows[0];
				if (current) {
					const token = randomBytes(32).toString("base64url");
					const expiresAt = new Date(Date.now() + 300000);
					await client.query(
						"INSERT INTO identity.verification(id,identifier,value,expires_at) VALUES($1,$2,$3,$4)",
						[
							randomUUID(),
							challengeId("reset", token),
							JSON.stringify({
								userId: user.id,
								credentialEpoch: Number(current.credential_epoch),
								recoveryEpoch: context.epoch,
							}),
							expiresAt,
						],
					);
					await enqueueIdentityEmail(client, {
						secret: options.secret,
						to: email,
						kind: "password-reset",
						locale: context.locale,
						url: `${options.origin}/auth/reset-password?token=${token}&locale=${context.locale}`,
						expiresAt,
					});
				}
			}
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
	async function resetPassword(token: string, password: string, epoch: string) {
		const identifier = challengeId("reset", token);
		const pending = (
			await pool.query<{ value: string }>(
				"SELECT value FROM identity.verification WHERE identifier=$1 AND expires_at>now()",
				[identifier],
			)
		).rows[0];
		if (!pending) throw new Error("Invalid reset");
		const challenge = passwordChallengeSchema.parse(JSON.parse(pending.value));
		const passwordHash = await hashPassword(password);
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"SELECT pg_advisory_xact_lock(hashtextextended('user:'||$1,0))",
				[challenge.userId],
			);
			const consumed = await client.query(
				"DELETE FROM identity.verification WHERE identifier=$1 AND value=$2 AND expires_at>clock_timestamp() RETURNING id",
				[identifier, pending.value],
			);
			const current = (
				await client.query<{ email: string; credential_epoch: string }>(
					"SELECT email,credential_epoch FROM identity.\"user\" WHERE id=$1 AND lifecycle_status='active' AND email_verified",
					[challenge.userId],
				)
			).rows[0];
			if (
				consumed.rowCount !== 1 ||
				!current ||
				Number(current.credential_epoch) !== challenge.credentialEpoch ||
				challenge.recoveryEpoch !== epoch ||
				(await ready()) !== epoch
			)
				throw new Error("Invalid reset");
			const updated = await client.query(
				"UPDATE identity.account SET password=$2,updated_at=now() WHERE user_id=$1 AND provider_id='credential' AND account_id=$1 AND password IS NOT NULL",
				[challenge.userId, passwordHash],
			);
			if (updated.rowCount !== 1) throw new Error("Invalid credential");
			await client.query(
				'UPDATE identity."user" SET credential_epoch=credential_epoch+1,updated_at=now() WHERE id=$1',
				[challenge.userId],
			);
			await client.query("DELETE FROM identity.session WHERE user_id=$1", [
				challenge.userId,
			]);
			// Invalidate outstanding email links, reset/registration challenges and any
			// provider trust/challenge records. Reset never removes an enrolled factor.
			await client.query(
				`DELETE FROM identity.verification WHERE value=$1 OR
CASE WHEN pg_input_is_valid(value,'jsonb') THEN value::jsonb->>'userId'=$1 OR value::jsonb->>'email'=$2 ELSE false END`,
				[challenge.userId, current.email],
			);
			await client.query(
				"INSERT INTO identity.security_audit(id,user_id,action) VALUES($1,$2,'password.reset')",
				[randomUUID(), challenge.userId],
			);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
	async function confirmRegistration(
		token: string,
		destination: string,
		headers: Headers,
		context: Ceremony,
	) {
		const identifier = challengeId("registration", token);
		const pending = (
			await pool.query<{ value: string }>(
				"SELECT value FROM identity.verification WHERE identifier=$1",
				[identifier],
			)
		).rows[0];
		const challenge = pending
			? passwordChallengeSchema.parse(JSON.parse(pending.value))
			: undefined;
		// Match the pinned magic-link plugin's hashed identifier. Resolve the user
		// before redemption so reset/freeze and ALL email confirmations serialize.
		const magic = (
			await pool.query<{ value: string }>(
				"SELECT value FROM identity.verification WHERE identifier=$1 AND expires_at>now()",
				[createHash("sha256").update(token).digest("base64url")],
			)
		).rows[0];
		if (!magic) throw new Error("Invalid confirmation");
		const email = z
			.object({ email: z.email() })
			.parse(JSON.parse(magic.value)).email;
		const user = (
			await pool.query<{ id: string }>(
				'SELECT id FROM identity."user" WHERE email=$1',
				[email],
			)
		).rows[0];
		if (!user || (challenge && challenge.userId !== user.id))
			throw new Error("Invalid confirmation");
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"SELECT pg_advisory_xact_lock(hashtextextended('user:'||$1,0))",
				[user.id],
			);
			const current = (
				await client.query<{
					email_verified: boolean;
					credential_epoch: string;
				}>(
					"SELECT email_verified,credential_epoch FROM identity.\"user\" WHERE id=$1 AND lifecycle_status='active'",
					[user.id],
				)
			).rows[0];
			if (!current || (await ready()) !== context.epoch)
				throw new Error("Invalid confirmation");
			if (challenge && pending) {
				const consumed = await client.query(
					"DELETE FROM identity.verification WHERE identifier=$1 AND value=$2 AND expires_at>clock_timestamp() RETURNING id",
					[identifier, pending.value],
				);
				if (
					consumed.rowCount !== 1 ||
					Number(current.credential_epoch) !== challenge.credentialEpoch ||
					challenge.recoveryEpoch !== context.epoch
				)
					throw new Error("Invalid registration");
			}
			const result = await providerFor(client).api.magicLinkVerify({
				query: { token, callbackURL: destination },
				headers,
				asResponse: true,
			});
			if (
				result.status >= 300 &&
				result.status < 400 &&
				!result.headers.get("location")?.includes("error=")
			) {
				// A generic email-link verification must never activate a password an
				// attacker preregistered for someone else's mailbox. Only this specific
				// registration link may install its hash, while identity is unverified.
				if (!current.email_verified && challenge?.passwordHash) {
					await client.query(
						"INSERT INTO identity.account(id,user_id,account_id,provider_id,password) VALUES($1,$2,$2,'credential',$3)",
						[randomUUID(), challenge.userId, challenge.passwordHash],
					);
					await client.query(
						"INSERT INTO identity.security_audit(id,user_id,action) VALUES($1,$2,'password.registered')",
						[randomUUID(), challenge.userId],
					);
				}
			}
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
	async function session(
		headers: Headers,
		options: { allowPendingMfa?: boolean; disableRefresh?: boolean } = {},
	): Promise<SessionIdentity | null> {
		const epoch = await ready();
		const result = await auth.api.getSession({
			headers,
			query: {
				disableCookieCache: true,
				disableRefresh: options.disableRefresh ?? false,
			},
		});
		if (!result) return null;
		const row = (
			await pool.query<{
				id: string;
				user_id: string;
				email: string;
				name: string;
				authentication_method: string;
				authenticated_at: Date;
				user_verified: boolean;
				mfa: boolean;
				credential_epoch: string;
				recovery_epoch: string;
				two_factor_enabled: boolean;
			}>(
				`SELECT s.*,u.email,u.name,u.two_factor_enabled FROM identity.session s JOIN identity."user" u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now() AND u.lifecycle_status='active' AND u.email_verified AND s.credential_epoch=u.credential_epoch AND s.recovery_epoch=$2`,
				[result.session.id, epoch],
			)
		).rows[0];
		if (
			!row ||
			!["magic-link", "password", "passkey", "totp", "recovery"].includes(
				row.authentication_method,
			) ||
			(row.two_factor_enabled && !row.mfa && !options.allowPendingMfa)
		)
			return null;
		return Object.freeze({
			userId: row.user_id,
			sessionId: row.id,
			email: row.email,
			name: row.name,
			method: row.authentication_method,
			authenticatedAt: row.authenticated_at,
			userVerified: row.user_verified,
			mfa: row.mfa,
			credentialEpoch: Number(row.credential_epoch),
			recoveryEpoch: row.recovery_epoch,
			twoFactorEnabled: row.two_factor_enabled,
		});
	}
	/** Under the caller's shared user fence, return the current session deadline for the protected transaction. */
	async function assertCurrent(actor: SessionIdentity): Promise<Date> {
		const epoch = await ready();
		if (epoch !== actor.recoveryEpoch)
			throw new Error("Identity recovery unavailable");
		const current = await pool.query<{ expires_at: Date }>(
			`SELECT s.expires_at FROM identity.session s JOIN identity."user" u ON u.id=s.user_id
   WHERE s.id=$1 AND s.user_id=$2 AND s.credential_epoch=$3 AND s.credential_epoch=u.credential_epoch
   AND date_trunc('milliseconds',s.authenticated_at)=$4 AND s.authentication_method=$5 AND s.mfa=$6
   AND s.recovery_epoch=$7 AND s.expires_at>now() AND u.lifecycle_status='active' AND u.email_verified
   AND (NOT u.two_factor_enabled OR s.mfa)`,
			[
				actor.sessionId,
				actor.userId,
				actor.credentialEpoch,
				actor.authenticatedAt,
				actor.method,
				actor.mfa,
				epoch,
			],
		);
		const deadline = current.rows[0]?.expires_at;
		if (current.rowCount !== 1 || !deadline)
			throw new Error("Session no longer active");
		return deadline;
	}

	async function throttle(key: string, max = 8) {
		const digest = createHmac("sha256", options.secret)
			.update(key)
			.digest("hex");
		const row = (
			await pool.query<{ count: number }>(
				`INSERT INTO identity.ingress_limit(key,window_start,count) VALUES($1,now(),1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN identity.ingress_limit.window_start<now()-interval '1 minute' THEN 1 ELSE identity.ingress_limit.count+1 END,window_start=CASE WHEN identity.ingress_limit.window_start<now()-interval '1 minute' THEN now() ELSE identity.ingress_limit.window_start END RETURNING count`,
				[digest],
			)
		).rows[0];
		return row.count <= max;
	}
	async function removePasskey(actor: SessionIdentity, id: string) {
		requireFreshAssurance(actor, { mfa: true });
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"SELECT pg_advisory_xact_lock(hashtextextended('user:'||$1,0))",
				[actor.userId],
			);
			await assertCurrent(actor);
			requireFreshAssurance(actor, { mfa: true });
			const current = (
				await client.query(
					'SELECT two_factor_enabled,credential_epoch,lifecycle_status FROM identity."user" WHERE id=$1',
					[actor.userId],
				)
			).rows[0];
			if (
				current?.lifecycle_status !== "active" ||
				Number(current.credential_epoch) !== actor.credentialEpoch
			)
				throw new Error("Identity unavailable");
			const keys = await client.query(
				"SELECT id FROM identity.passkey WHERE user_id=$1",
				[actor.userId],
			);
			if (!keys.rows.some((row) => row.id === id))
				throw new Error("Unknown credential");
			if (keys.rowCount === 1 && !current.two_factor_enabled)
				throw new Error(
					"Enroll an independent recovery factor before removing the last passkey",
				);
			await client.query(
				"DELETE FROM identity.passkey WHERE id=$1 AND user_id=$2",
				[id, actor.userId],
			);
			await client.query(
				"DELETE FROM identity.session WHERE user_id=$1 AND id<>$2",
				[actor.userId, actor.sessionId],
			);
			await client.query(
				"INSERT INTO identity.security_audit(id,user_id,action) VALUES($1,$2,'passkey.revoked')",
				[randomUUID(), actor.userId],
			);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
	const allowed = new Set([
		"/get-session",
		"/sign-out",
		"/list-sessions",
		"/revoke-session",
		"/revoke-sessions",
		"/revoke-other-sessions",
		"/sign-in/magic-link",
		"/sign-in/email",
		"/passkey/generate-register-options",
		"/passkey/verify-registration",
		"/passkey/generate-authenticate-options",
		"/passkey/verify-authentication",
		"/passkey/list-user-passkeys",
		"/passkey/update-passkey",
		"/two-factor/enable",
		"/two-factor/disable",
		"/two-factor/verify-totp",
		"/two-factor/verify-backup-code",
		"/two-factor/generate-backup-codes",
	]);
	type Failure = {
		userId?: string;
		reason?: "invalid_input" | "rate_limited" | "untrusted_ingress" | "denied";
		diagnostic?: string;
	};
	async function handleRequest(
		request: Request,
		failure: Failure,
	): Promise<Response> {
		const url = new URL(request.url);
		if (
			["/api/auth/personal-settings", "/api/auth/avatar"].includes(url.pathname)
		)
			return personalSettings.handle(request);
		const route = url.pathname.replace(/^\/api\/auth/, "");
		const json = (value: unknown, status = 200) =>
			Response.json(value, { status, headers: protectedHeaders });
		let stage = "request";
		try {
			if (
				request.method !== "GET" &&
				(request.headers.get("origin") !== options.origin ||
					!request.headers.get("content-type")?.startsWith("application/json"))
			)
				return json({ error: "Forbidden" }, 403);
			if (url.pathname === "/auth/confirm" && request.method === "GET")
				return new Response(
					"Open the sign-in confirmation page and confirm to continue.",
					{ headers: protectedHeaders },
				);
			if (
				[
					"/magic-link/verify",
					"/delete-user",
					"/delete-user/callback",
					"/passkey/delete-passkey",
				].includes(route)
			)
				return json({ error: "Domain command required" }, 405);
			stage = "readiness";
			const epoch = await ready();
			stage = "input";
			const body =
				request.method === "POST"
					? await request
							.clone()
							.json()
							.catch(() => null)
					: null;
			if (request.method === "POST" && !body)
				return json({ error: "Invalid input" }, 400);
			const context: Ceremony = {
				method: "magic-link",
				userVerified: false,
				mfa: false,
				epoch,
				locale: body?.locale === "es" ? "es" : "en",
				source: ingressSource(request, ingressSecret),
				route,
			};
			return await ceremonies.run(context, async () => {
				if (
					route === "/register" ||
					route === "/request-recovery" ||
					route === "/request-password-reset" ||
					route === "/sign-in/magic-link"
				) {
					if (request.method !== "POST")
						return json({ error: "Method not allowed" }, 405);
					const parsed = z
						.object({
							email: z.email().max(254),
							name: z.string().trim().min(1).max(100).optional(),
							callbackURL: z.string().optional(),
						})
						.safeParse(body);
					if (!parsed.success) {
						failure.reason = "invalid_input";
						return json({ status: true });
					}
					const email = parsed.data.email.trim().toLowerCase();
					const password =
						route === "/register" && body.password !== undefined
							? passwordSchema.safeParse(body.password)
							: undefined;
					if (password && !password.success)
						return json(
							{ error: "Password must contain 12 to 128 characters" },
							400,
						);
					const source = context.source;
					if (source === null) {
						failure.reason = "untrusted_ingress";
						return json({ status: true });
					}
					// Denied sources never spend another source's global capacity. Bucket keys
					// are HMACs; raw addresses and email identities never enter rate-limit rows.
					if (
						!(await throttle(`source:${source}`, 20)) ||
						!(await throttle("global", 100)) ||
						!(await throttle(`email:${email}`, 5))
					) {
						failure.reason = "rate_limited";
						return json({ status: true });
					}
					if (parsed.data.callbackURL)
						safeDestination(parsed.data.callbackURL, options.origin);
					if (route === "/request-password-reset") {
						await issuePasswordReset(email, context);
						return json({ status: true });
					}
					if (route === "/register") {
						await pool.query(
							'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$2,$3,false) ON CONFLICT(email) DO NOTHING',
							[randomUUID(), parsed.data.name ?? email.split("@")[0], email],
						);
						context.kind = "verification";
						if (password?.success) {
							const passwordHash = await hashPassword(password.data);
							const client = await pool.connect();
							try {
								await client.query("BEGIN");
								const user = (
									await client.query<{ id: string }>(
										'SELECT id FROM identity."user" WHERE email=$1',
										[email],
									)
								).rows[0];
								await client.query(
									"SELECT pg_advisory_xact_lock(hashtextextended('user:'||$1,0))",
									[user.id],
								);
								const current = (
									await client.query<{ credential_epoch: string }>(
										"SELECT credential_epoch FROM identity.\"user\" WHERE id=$1 AND lifecycle_status='active' AND NOT email_verified",
										[user.id],
									)
								).rows[0];
								if (current) {
									context.registration = {
										userId: user.id,
										passwordHash,
										credentialEpoch: Number(current.credential_epoch),
									};
									context.database = client;
									await providerFor(client).api.signInMagicLink({
										body: { email, callbackURL: "/account" },
										headers: request.headers,
									});
								}
								await client.query("COMMIT");
							} catch (error) {
								await client.query("ROLLBACK");
								throw error;
							} finally {
								context.database = undefined;
								client.release();
							}
							return json({ status: true });
						}
					}
					if (route === "/request-recovery") context.kind = "reset";
					const user = (
						await pool.query<{ id: string }>(
							'SELECT id FROM identity."user" WHERE email=$1',
							[email],
						)
					).rows[0];
					if (!user) return json({ status: true });
					const client = await pool.connect();
					try {
						await client.query("BEGIN");
						await client.query(
							"SELECT pg_advisory_xact_lock(hashtextextended('user:'||$1,0))",
							[user.id],
						);
						const current = await client.query(
							"SELECT id FROM identity.\"user\" WHERE id=$1 AND lifecycle_status='active'",
							[user.id],
						);
						if (current.rowCount) {
							// Issue the challenge and encrypted email on the same fenced
							// transaction so a concurrent reset cannot miss a pending link.
							context.database = client;
							await providerFor(client).api.signInMagicLink({
								body: { email, callbackURL: "/account" },
								headers: request.headers,
							});
						}
						await client.query("COMMIT");
					} catch (error) {
						await client.query("ROLLBACK");
						throw error;
					} finally {
						context.database = undefined;
						client.release();
					}
					return json({ status: true });
				}
				if (route === "/reset-password") {
					if (request.method !== "POST")
						return json({ error: "Confirmation required" }, 405);
					const parsed = z
						.object({
							token: z.string().min(20).max(512),
							newPassword: passwordSchema,
						})
						.safeParse(body);
					if (!parsed.success)
						return json({ error: "Invalid reset request" }, 400);
					if (
						context.source === null ||
						!(await throttle(`password-reset:source:${context.source}`, 20)) ||
						!(await throttle(`password-reset:token:${parsed.data.token}`, 5))
					)
						return json({ error: "Try again later" }, 429);
					await resetPassword(
						parsed.data.token,
						parsed.data.newPassword,
						epoch,
					);
					return json({ status: true });
				}
				if (url.pathname === "/auth/confirm" || route === "/confirm") {
					if (request.method !== "POST")
						return json({ error: "Confirmation required" }, 405);
					const parsed = z
						.object({
							token: z.string().min(20).max(512),
							destination: z.string().default("/account"),
						})
						.safeParse(body);
					if (!parsed.success)
						return json({ error: "Invalid confirmation" }, 400);
					const destination = safeDestination(
						parsed.data.destination,
						options.origin,
					);
					if (!(await throttle(`confirm:${parsed.data.token}`, 10)))
						return json({ error: "Invalid or expired confirmation" }, 400);
					const result = await confirmRegistration(
						parsed.data.token,
						destination,
						request.headers,
						context,
					);
					const headers = new Headers(result.headers);
					for (const [key, value] of Object.entries(protectedHeaders))
						headers.set(key, value);
					// Return a JSON destination so fetch cannot follow and discard an authentication redirect.
					if (
						result.status >= 300 &&
						result.status < 400 &&
						!headers.get("location")?.includes("error=")
					) {
						headers.delete("location");
						return Response.json({ destination }, { headers });
					}
					return new Response(result.body, { status: result.status, headers });
				}
				if (!allowed.has(route) && route !== "/revoke-passkey")
					return json({ error: "Not found" }, 404);
				const anonymous =
					route === "/sign-in/email" ||
					route === "/passkey/generate-authenticate-options" ||
					route === "/passkey/verify-authentication";
				let passwordUser: string | undefined;
				if (route === "/sign-in/email") {
					const parsed = z
						.object({
							email: z.email().max(254),
							password: z.string().min(1).max(128),
						})
						.safeParse(body);
					if (request.method !== "POST" || !parsed.success)
						return json({ error: "Invalid email or password" }, 401);
					const email = parsed.data.email.toLowerCase();
					if (
						context.source === null ||
						!(await throttle(`password:source:${context.source}`, 20)) ||
						!(await throttle("password:global", 100)) ||
						!(await throttle(`password:email:${email}`, 5))
					)
						return json({ error: "Try again later" }, 429);
					passwordUser = (
						await pool.query<{ id: string }>(
							'SELECT id FROM identity."user" WHERE email=$1',
							[email],
						)
					).rows[0]?.id;
					if (!passwordUser) {
						// Never let a user appearing after this lookup authenticate outside
						// the lifecycle fence. Match the provider's unknown-user hash cost.
						await hashPassword(parsed.data.password);
						return json({ error: "Invalid email or password" }, 401);
					}
					context.method = "password";
					// Forward only accepted inputs; redirect destinations and session/assurance
					// fields cannot be supplied by the caller.
					request = new Request(request.url, {
						method: "POST",
						headers: request.headers,
						body: JSON.stringify({ email, password: parsed.data.password }),
					});
				}
				const pendingAllowed = [
					"/get-session",
					"/sign-out",
					"/two-factor/verify-totp",
					"/two-factor/verify-backup-code",
				].includes(route);
				stage = "session";
				const actor = anonymous
					? null
					: await session(request.headers, { allowPendingMfa: pendingAllowed });
				if (actor) {
					failure.userId = actor.userId;
					context.authenticatedAt = actor.authenticatedAt;
					context.method = actor.method as Ceremony["method"];
					context.mfa = actor.mfa;
					context.userVerified = actor.userVerified;
				}
				if (!anonymous && !actor)
					return json({ error: "Authentication required" }, 401);
				stage = "assurance";
				if (
					actor &&
					[
						"/passkey/generate-register-options",
						"/passkey/verify-registration",
						"/two-factor/enable",
						"/two-factor/generate-backup-codes",
						"/two-factor/disable",
					].includes(route)
				)
					requireFreshAssurance(actor, {
						mfa: actor.twoFactorEnabled || route === "/two-factor/disable",
					});
				if (route === "/two-factor/enable" && body?.method === "otp")
					return json({ error: "Use an authenticator application" }, 400);
				if (route === "/passkey/verify-registration" && body?.createSession)
					return json({ error: "Register from your existing session" }, 400);
				if (route === "/revoke-passkey" && actor) {
					await removePasskey(
						actor,
						z.object({ id: z.string() }).parse(body).id,
					);
					return json({ status: true });
				}
				if (
					(route === "/two-factor/verify-totp" ||
						route === "/two-factor/verify-backup-code") &&
					actor
				) {
					if (!(await throttle(`factor:${actor.userId}`, 5)))
						return json({ error: "Try again later" }, 429);
					context.authenticatedAt = new Date();
					context.method = route.endsWith("totp") ? "totp" : "recovery";
					context.mfa = true;
				}
				stage = "credential";
				const credentialUser =
					route === "/passkey/verify-authentication" &&
					typeof body?.response?.id === "string"
						? (
								await pool.query<{ user_id: string }>(
									"SELECT user_id FROM identity.passkey WHERE credential_id=$1",
									[body.response.id],
								)
							).rows[0]?.user_id
						: undefined;
				if (route === "/passkey/verify-authentication" && !credentialUser)
					return json({ error: "Authentication failed" }, 401);
				const lockedUser = actor?.userId ?? credentialUser ?? passwordUser;
				stage = "fence";
				const guard = lockedUser ? await pool.connect() : undefined;
				let result: Response;
				try {
					if (guard) {
						await guard.query("BEGIN");
						const exclusive = [
							"/sign-out",
							"/revoke-session",
							"/revoke-sessions",
							"/revoke-other-sessions",
							"/passkey/verify-registration",
							"/two-factor/enable",
							"/two-factor/disable",
							"/two-factor/generate-backup-codes",
							"/two-factor/verify-totp",
							"/two-factor/verify-backup-code",
						].includes(route);
						await guard.query(
							exclusive
								? "SELECT pg_advisory_xact_lock(hashtextextended('user:'||$1,0))"
								: "SELECT pg_advisory_xact_lock_shared(hashtextextended('user:'||$1,0))",
							[lockedUser],
						);
						const credentialMutation = [
							"/passkey/verify-registration",
							"/two-factor/enable",
							"/two-factor/disable",
							"/two-factor/generate-backup-codes",
						].includes(route);
						if (credentialMutation)
							await guard.query(
								"SELECT pg_advisory_xact_lock(hashtextextended('identity:credentials:'||$1,0))",
								[lockedUser],
							);
						const current = (
							await guard.query(
								'SELECT lifecycle_status,credential_epoch FROM identity."user" WHERE id=$1',
								[lockedUser],
							)
						).rows[0];
						if (
							current?.lifecycle_status !== "active" ||
							(actor &&
								Number(current.credential_epoch) !== actor.credentialEpoch)
						) {
							if (route === "/sign-in/email") await hashPassword(body.password);
							throw new Error("Identity unavailable");
						}
						if (actor && credentialMutation) {
							await assertCurrent(actor);
							requireFreshAssurance(actor, {
								mfa:
									actor.twoFactorEnabled ||
									route === "/two-factor/disable" ||
									route === "/two-factor/generate-backup-codes",
							});
							const existingKeys = (
								await guard.query(
									"SELECT count(*)::int AS count FROM identity.passkey WHERE user_id=$1",
									[lockedUser],
								)
							).rows[0].count;
							if (
								["/passkey/verify-registration", "/two-factor/enable"].includes(
									route,
								) &&
								existingKeys > 0
							)
								requireFreshAssurance(actor, { mfa: true });
							if (route === "/two-factor/disable" && !existingKeys)
								throw new Error(
									"Enroll a passkey before disabling your recovery factor",
								);
						}
						if (
							credentialUser &&
							!(
								await guard.query(
									"SELECT 1 FROM identity.passkey WHERE credential_id=$1 AND user_id=$2",
									[body.response.id, credentialUser],
								)
							).rowCount
						)
							throw new Error("Credential revoked");
					}
					// Bind every provider query to this already-fenced transaction. A session
					// trigger must not reacquire its user lock on a second pooled connection.
					const provider = guard ? providerFor(guard) : auth;
					stage = "provider";
					result = await provider.handler(request);
					if (route === "/sign-in/email" && !result.ok)
						result = json({ error: "Invalid email or password" }, 401);
					if (
						actor &&
						result.ok &&
						(route === "/two-factor/verify-totp" ||
							route === "/two-factor/verify-backup-code")
					) {
						// Only a successful provider cryptographic verification can upgrade assurance.
						await guard?.query(
							"UPDATE identity.session SET mfa=true,authentication_method=$2,authenticated_at=now() WHERE id=$1 AND credential_epoch=$3 AND recovery_epoch=$4",
							[actor.sessionId, context.method, actor.credentialEpoch, epoch],
						);
					}
					stage = "commit";
					if (guard) await guard.query("COMMIT");
				} catch (error) {
					if (guard) await guard.query("ROLLBACK");
					throw error;
				} finally {
					guard?.release();
				}
				const headers = new Headers(result.headers);
				for (const [key, value] of Object.entries(protectedHeaders))
					headers.set(key, value);
				return new Response(result.body, { status: result.status, headers });
			});
		} catch (error) {
			// Fixed stages and a closed code list aid diagnosis without exposing driver
			// messages, SQL, credential material, or request input.
			const code =
				error && typeof error === "object" && "code" in error
					? error.code
					: undefined;
			const cause =
				typeof code === "string" &&
				[
					"40001",
					"40P01",
					"55P03",
					"57014",
					"25P02",
					"57P01",
					"08006",
					"42P01",
					"42703",
					"22P02",
					"22023",
				].includes(code)
					? code
					: error instanceof TypeError
						? "type_error"
						: "internal";
			failure.diagnostic = `${stage}.${cause}`;
			if (stage === "readiness")
				return json({ error: "Identity unavailable" }, 503);
			if (route === "/sign-in/email")
				return json({ error: "Invalid email or password" }, 401);
			return json({ error: "Identity action unavailable" }, 400);
		}
	}
	let nextAuditUnavailableLog = 0;
	async function handler(request: Request): Promise<Response> {
		const failure: Failure = {};
		const response = await handleRequest(request, failure);
		if (!response.ok) failure.reason ??= "denied";
		if (!failure.reason) return response;
		const route = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
		const operation =
			allowed.has(route) ||
			[
				"/register",
				"/request-recovery",
				"/request-password-reset",
				"/reset-password",
				"/confirm",
				"/revoke-passkey",
			].includes(route)
				? `identity${route.replaceAll("/", ".").replaceAll("-", "_")}`
				: "identity.unknown";
		try {
			// Anonymous floods cannot spend a verified actor's durable audit allowance.
			// Actor keys come only from the verified session, never from request bodies.
			if (
				!(await throttle(
					failure.userId
						? `security-events:actor:${failure.userId}`
						: "security-events:anonymous",
					failure.userId ? 20 : 100,
				))
			)
				return response;
			logEvent("identity.action_denied", {
				operation,
				status: failure.diagnostic ?? failure.reason,
			});
			if (failure.userId)
				await pool.query(
					"INSERT INTO identity.security_audit(id,user_id,action) VALUES($1,$2,$3)",
					[randomUUID(), failure.userId, `${operation}.denied`],
				);
		} catch {
			// A failed action stays denied when the audit store is down. Emit only a bounded fixed code.
			if (Date.now() >= nextAuditUnavailableLog) {
				nextAuditUnavailableLog = Date.now() + 60000;
				logEvent("identity.audit_unavailable", { operation });
			}
		}
		return response;
	}
	const personalSettings = createPersonalSettings(pool, {
		origin: options.origin,
		// Personal reads/uploads never silently extend a session outside its fence.
		session: (headers) => session(headers, { disableRefresh: true }),
		assertCurrent,
		throttle,
	});
	return { handler, session, assertCurrent, auth, personalSettings };
}

export type { PersonalSettings } from "./personal-settings";
