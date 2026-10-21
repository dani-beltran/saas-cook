import { createHash, createHmac, randomUUID } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { operatorIdentitySchema } from "@saas-cook/db/backoffice-schema";
import { logEvent } from "@saas-cook/observability";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { operatorCookies } from "./cookies";
import { operatorNetworks, requireOperatorIngress } from "./network";
import { boundedOperatorRequest } from "./request";

/** Verified staff session; only produced after the isolated Better Auth session and current epoch checks. */
export type OperatorSession = {
	id: string;
	userId: string;
	epoch: string;
	expiresAt: Date;
};
/** Creates an isolated passkey runtime. All handlers hold the operator fence until commit; errors disclose no auth payloads. */
export function createOperatorIdentity(options: {
	pool: Pool;
	origin: string;
	secret: string;
	ingressSecret: string;
	cidrs: string[];
	publication: (c: PoolClient) => Promise<{ epoch: string }>;
}) {
	const networks = operatorNetworks(options.cidrs);
	const network = (request: Request) =>
		requireOperatorIngress(request, {
			origin: options.origin,
			secret: options.ingressSecret,
			networks,
		});
	function provider(
		c: PoolClient,
		epoch: string,
		invitation: string | undefined,
	) {
		let verified = false;
		const invitationDigest = invitation
			? createHash("sha256").update(invitation).digest("hex")
			: "";
		async function invite(userId?: string) {
			const row = (
				await c.query(
					`SELECT i.id,i.user_id,u.name FROM backoffice.invitations i JOIN operator_identity."user" u ON u.id=i.user_id WHERE i.digest=$1 AND i.epoch=$2 AND u.epoch=$2 AND u.status='invited' AND i.consumed_at IS NULL AND i.expires_at>clock_timestamp() FOR UPDATE OF i`,
					[invitationDigest, epoch],
				)
			).rows[0];
			if (!row || (userId && row.user_id !== userId))
				throw new Error("Invitation unavailable");
			return row;
		}
		return betterAuth({
			database: drizzleAdapter(drizzle(c, { schema: operatorIdentitySchema }), {
				provider: "pg",
				schema: operatorIdentitySchema,
				transaction: false,
			}),
			baseURL: options.origin,
			basePath: "/api/auth",
			secret: options.secret,
			trustedOrigins: [options.origin],
			logger: { disabled: true },
			onAPIError: { throw: true },
			emailAndPassword: { enabled: false },
			account: { accountLinking: { enabled: false } },
			user: {
				deleteUser: { enabled: false },
				additionalFields: {
					epoch: { type: "string", input: false },
					status: { type: "string", input: false, defaultValue: "invited" },
				},
			},
			rateLimit: { enabled: false },
			advanced: operatorCookies(options.origin),
			session: {
				expiresIn: 28800,
				updateAge: 28800,
				cookieCache: { enabled: false },
				additionalFields: {
					epoch: { type: "string", input: false },
					verified: { type: "boolean", input: false, defaultValue: false },
					lastSeenAt: { type: "date", input: false },
				},
			},
			databaseHooks: {
				verification: {
					create: {
						before: async (data) => ({
							data: {
								...data,
								value: JSON.stringify({
									...JSON.parse(data.value),
									operatorEpoch: epoch,
								}),
							},
						}),
					},
					delete: {
						before: async (data) => {
							if (JSON.parse(data.value).operatorEpoch !== epoch)
								throw new Error("Restored challenge denied");
						},
					},
				},
				session: {
					create: {
						before: async (data) => {
							const user = (
								await c.query(
									`SELECT 1 FROM operator_identity."user" WHERE id=$1 AND status='active' AND epoch=$2`,
									[data.userId, epoch],
								)
							).rowCount;
							if (!verified || !user)
								throw new Error("Verified active operator required");
							await c.query(
								"INSERT INTO backoffice.audit_events(id,actor_id,action,outcome,epoch) VALUES($1,$2,'staff.signin','allowed',$3)",
								[randomUUID(), data.userId, epoch],
							);
							return {
								data: {
									...data,
									epoch,
									verified: true,
									lastSeenAt: new Date(),
								},
							};
						},
					},
				},
			},
			plugins: [
				passkey({
					rpID: new URL(options.origin).hostname,
					rpName: "SaaS Cook Backoffice",
					origin: options.origin,
					authenticatorSelection: {
						residentKey: "required",
						userVerification: "required",
					},
					registration: {
						requireSession: false,
						resolveUser: async () => {
							const row = await invite();
							return { id: row.user_id, name: row.name };
						},
						afterVerification: async ({ verification, user }) => {
							if (!verification.registrationInfo?.userVerified)
								throw new Error("User verification required");
							const row = await invite(user.id);
							await c.query(
								"INSERT INTO backoffice.audit_events(id,actor_id,action,outcome,epoch) VALUES($1,$2,'staff.enrollment','allowed',$3)",
								[randomUUID(), user.id, epoch],
							);
							await c.query(
								"UPDATE backoffice.invitations SET consumed_at=clock_timestamp() WHERE id=$1",
								[row.id],
							);
							await c.query(
								`UPDATE operator_identity."user" SET status='active' WHERE id=$1 AND epoch=$2`,
								[user.id, epoch],
							);
							verified = true;
						},
					},
					authentication: {
						afterVerification: async ({ verification }) => {
							if (!verification.authenticationInfo.userVerified)
								throw new Error("User verification required");
							verified = true;
						},
					},
				}),
			],
		});
	}
	async function transaction<T>(
		request: Request,
		work: (
			c: PoolClient,
			epoch: string,
			auth: ReturnType<typeof provider>,
		) => Promise<T>,
	): Promise<T> {
		const source = network(request);
		// Admission is durable even if a ceremony later rolls back. Hash the source; never store IPs.
		const key = createHmac("sha256", options.secret)
			.update(source)
			.digest("hex")
			.slice(0, 4);
		const rate = (
			await options.pool.query(
				`INSERT INTO backoffice.rate_limits VALUES($1,clock_timestamp(),1) ON CONFLICT(key) DO UPDATE SET started_at=CASE WHEN backoffice.rate_limits.started_at<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE backoffice.rate_limits.started_at END,count=CASE WHEN backoffice.rate_limits.started_at<clock_timestamp()-interval '1 minute' THEN 1 ELSE least(backoffice.rate_limits.count+1,61) END RETURNING count`,
				[key],
			)
		).rows[0];
		if (rate.count > 60) throw new Error("Operator rate limit");
		const c = await options.pool.connect();
		try {
			await c.query("BEGIN");
			await c.query("SET LOCAL statement_timeout='2s'");
			await c.query("SET LOCAL lock_timeout='250ms'");
			await c.query("SELECT pg_advisory_xact_lock_shared(1849202603)");
			await c.query("SELECT pg_advisory_xact_lock_shared(1849202610)");
			const state = await options.publication(c);
			await c.query(
				"DELETE FROM operator_identity.verification WHERE id IN (SELECT id FROM operator_identity.verification WHERE expires_at<clock_timestamp() LIMIT 50)",
			);
			const auth = provider(
				c,
				state.epoch,
				request.headers.get("x-backoffice-invitation") ?? undefined,
			);
			const result = await work(c, state.epoch, auth);
			if ((await options.publication(c)).epoch !== state.epoch)
				throw new Error("Operator epoch changed");
			await c.query("COMMIT");
			return result;
		} catch (e) {
			await c.query("ROLLBACK");
			throw e;
		} finally {
			c.release();
		}
	}
	return {
		network,
		/** Handles only passkey ceremonies and sign-out; arbitrary Better Auth endpoints are not mounted. */
		async handle(request: Request) {
			try {
				network(request);
				request = await boundedOperatorRequest(request);
			} catch {
				return Response.json({ error: "Denied" }, { status: 403 });
			}
			const path = new URL(request.url).pathname;
			const allowed = new Map([
				["/api/auth/passkey/generate-register-options", "GET"],
				["/api/auth/passkey/verify-registration", "POST"],
				["/api/auth/passkey/generate-authenticate-options", "GET"],
				["/api/auth/passkey/verify-authentication", "POST"],
				["/api/auth/sign-out", "POST"],
			]);
			if (allowed.get(path) !== request.method)
				return Response.json({ error: "Denied" }, { status: 403 });
			try {
				return await transaction(request, async (c, epoch, auth) => {
					const response = await auth.handler(request);
					if (!response.ok) throw new Error("Ceremony denied");
					await c.query(
						"INSERT INTO backoffice.audit_events(id,action,outcome,epoch) VALUES($1,$2,$3,$4)",
						[
							randomUUID(),
							path.slice(10),
							response.ok ? "allowed" : "denied",
							epoch,
						],
					);
					// Never return provider session tokens, credential material or staff profiles in JSON.
					if (path.includes("verify-") && response.ok) {
						const headers = new Headers(response.headers);
						headers.delete("content-length");
						return new Response(JSON.stringify({ ok: true }), {
							status: 200,
							headers,
						});
					}
					return response;
				});
			} catch {
				await options.pool
					.query(
						"INSERT INTO backoffice.audit_events(id,action,outcome) VALUES($1,'staff.authentication','denied')",
						[randomUUID()],
					)
					.catch(() => {
						logEvent("backoffice.audit_unavailable", {
							operation: "authentication",
						});
					});
				return Response.json({ error: "Unavailable" }, { status: 503 });
			}
		},
		/** Holds current staff authority while a protected operation runs and checks expiry after it finishes. */
		async withSession<T>(
			request: Request,
			work: (session: OperatorSession) => Promise<T>,
		) {
			return transaction(request, async (c, epoch, auth) => {
				const cookie = request.headers.get("cookie") ?? "";
				const name = options.origin.startsWith("https:")
					? "__Host-backoffice-session"
					: "backoffice-session";
				if (
					cookie.split(";").filter((v) => v.trim().startsWith(`${name}=`))
						.length !== 1
				)
					throw new Error("Operator session required");
				const session = await auth.api.getSession({
					headers: request.headers,
					query: { disableCookieCache: true, disableRefresh: true },
				});
				if (!session) throw new Error("Operator session required");
				const current = (
					await c.query(
						`SELECT s.id,s.user_id,least(s.expires_at,s.created_at+interval '8 hours',s.last_seen_at+interval '30 minutes') AS deadline FROM operator_identity.session s JOIN operator_identity."user" u ON u.id=s.user_id WHERE s.id=$1 AND s.verified AND s.epoch=$2 AND u.epoch=$2 AND u.status='active' AND least(s.expires_at,s.created_at+interval '8 hours',s.last_seen_at+interval '30 minutes')>clock_timestamp()`,
						[session.session.id, epoch],
					)
				).rows[0];
				if (!current) throw new Error("Operator session required");
				const result = await work({
					id: current.id,
					userId: current.user_id,
					epoch,
					expiresAt: current.deadline,
				});
				if (
					!(
						await c.query("SELECT $1::timestamptz>clock_timestamp() AS valid", [
							current.deadline,
						])
					).rows[0].valid
				)
					throw new Error("Operator session expired");
				await c.query(
					"UPDATE operator_identity.session SET last_seen_at=clock_timestamp() WHERE id=$1",
					[current.id],
				);
				return result;
			});
		},
	};
}
