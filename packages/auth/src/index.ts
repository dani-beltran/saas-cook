import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomUUID } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { identitySchema } from "@common-saas/db/schema";
import { enqueueIdentityEmail } from "@common-saas/email";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { magicLink, twoFactor } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";

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
	method: "magic-link" | "passkey" | "totp" | "recovery";
	userVerified: boolean;
	mfa: boolean;
	epoch: string;
	locale: "en" | "es";
	kind?: "verification" | "reset";
};
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
	},
) {
	const options = optionsSchema.parse({
		secret: input.secret,
		origin: input.origin,
	});
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
		secret: options.secret,
		emailAndPassword: { enabled: false },
		user: { deleteUser: { enabled: false } },
		account: { accountLinking: { enabled: false } },
		logger: { disabled: true },
		disabledPaths: [
			"/magic-link/verify",
			"/delete-user",
			"/delete-user/callback",
			"/passkey/delete-passkey",
		],
		rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
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
					await enqueueIdentityEmail(pool, {
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
				rpName: input.rpName ?? "Common SaaS",
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
			twoFactor({
				issuer: input.rpName ?? "Common SaaS",
				allowPasswordless: true,
				skipVerificationOnEnable: false,
			}),
		],
	});
	async function session(
		headers: Headers,
		options: { allowPendingMfa?: boolean } = {},
	): Promise<SessionIdentity | null> {
		const epoch = await ready();
		const result = await auth.api.getSession({
			headers,
			query: { disableCookieCache: true },
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
			!["magic-link", "passkey", "totp", "recovery"].includes(
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
	/** Called while the caller holds the canonical shared user fence. Never refreshes cookies or acquires another lock. */
	async function assertCurrent(actor: SessionIdentity) {
		const epoch = await ready();
		if (epoch !== actor.recoveryEpoch)
			throw new Error("Identity recovery unavailable");
		const current = await pool.query(
			`SELECT 1 FROM identity.session s JOIN identity."user" u ON u.id=s.user_id
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
		if (current.rowCount !== 1) throw new Error("Session no longer active");
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
	async function handler(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const route = url.pathname.replace(/^\/api\/auth/, "");
		const json = (value: unknown, status = 200) =>
			Response.json(value, { status, headers: protectedHeaders });
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
			const epoch = await ready();
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
			};
			return await ceremonies.run(context, async () => {
				if (
					route === "/register" ||
					route === "/request-recovery" ||
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
					if (!parsed.success) return json({ status: true });
					const email = parsed.data.email.trim().toLowerCase();
					// No forwarded identity/IP header is trusted. The global bucket bounds untrusted ingress;
					// the keyed bucket prevents attacks on a particular identity across application processes.
					if (
						!(await throttle("global", 100)) ||
						!(await throttle(`email:${email}`, 5))
					)
						return json({ status: true });
					if (parsed.data.callbackURL)
						safeDestination(parsed.data.callbackURL, options.origin);
					if (route === "/register") {
						await pool.query(
							'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$2,$3,false) ON CONFLICT(email) DO NOTHING',
							[randomUUID(), parsed.data.name ?? email.split("@")[0], email],
						);
						context.kind = "verification";
					}
					if (route === "/request-recovery") context.kind = "reset";
					await auth.api.signInMagicLink({
						body: { email, callbackURL: "/account" },
						headers: request.headers,
					});
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
					const result = await auth.api.magicLinkVerify({
						query: { token: parsed.data.token, callbackURL: destination },
						headers: request.headers,
						asResponse: true,
					});
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
					route === "/passkey/generate-authenticate-options" ||
					route === "/passkey/verify-authentication";
				const pendingAllowed = [
					"/get-session",
					"/sign-out",
					"/two-factor/verify-totp",
					"/two-factor/verify-backup-code",
				].includes(route);
				const actor = anonymous
					? null
					: await session(request.headers, { allowPendingMfa: pendingAllowed });
				if (actor) {
					context.authenticatedAt = actor.authenticatedAt;
					context.method = actor.method as Ceremony["method"];
					context.mfa = actor.mfa;
					context.userVerified = actor.userVerified;
				}
				if (!anonymous && !actor)
					return json({ error: "Authentication required" }, 401);
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
				const lockedUser = actor?.userId ?? credentialUser;
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
						)
							throw new Error("Identity unavailable");
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
					const provider = guard
						? betterAuth({
								...auth.options,
								database: drizzleAdapter(
									drizzle(guard, { schema: identitySchema }),
									{
										provider: "pg",
										schema: identitySchema,
										transaction: false,
									},
								),
							})
						: auth;
					result = await provider.handler(request);
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
		} catch {
			return json({ error: "Identity action unavailable" }, 400);
		}
	}
	return { handler, session, assertCurrent, auth };
}
