import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ResourceError, type ResourceHooks } from "../resources";
import {
	appendTenantAudit,
	type TenantActor,
	withTenantTransaction,
} from "../tenancy";
export function createNotifications(
	pool: Pool,
	hooks: Pick<ResourceHooks, "authorize">,
	options: {
		secret: string;
		ready: (c: PoolClient) => Promise<unknown>;
		send?: (message: {
			id: string;
			to: string;
			locale: "en" | "es";
			organizationId: string;
			unsubscribe: string;
		}) => Promise<void>;
	},
) {
	const token = (user: string) =>
		`${Buffer.from(user).toString("base64url")}.${createHmac("sha256", options.secret).update(`optional-email:${user}`).digest("base64url")}`;
	async function own<T>(
		a: TenantActor,
		org: string | null,
		work: (c: PoolClient) => Promise<T>,
	) {
		if (!a.assertCurrent || "kind" in a) throw new ResourceError("DENIED");
		return withTenantTransaction(
			pool,
			org ?? "00000000-0000-4000-8000-000000000000",
			[a.userId],
			false,
			async (c) => {
				await options.ready(c);
				const deadline = await a.assertCurrent?.();
				if (deadline)
					await c.query(
						"SELECT set_config('app.authorization_expires_at',$1,true)",
						[deadline.toISOString()],
					);
				await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
					`notification:${a.userId}`,
				]);
				if (org)
					await hooks.authorize(
						c,
						a,
						org,
						{ type: "organization", id: org },
						"read",
					);
				return work(c);
			},
			undefined,
			false,
		);
	}
	async function suppress(user: string) {
		return withTenantTransaction(
			pool,
			"00000000-0000-4000-8000-000000000000",
			[user],
			false,
			async (c) => {
				await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
					`notification:${user}`,
				]);
				await c.query(
					"INSERT INTO foundation.notification_preferences(user_id,email_suppressed) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET email_suppressed=true,version=notification_preferences.version+1 WHERE NOT notification_preferences.email_suppressed",
					[user],
				);
			},
			undefined,
			false,
		);
	}

	return {
		async preferences(a: TenantActor) {
			return own(a, null, async (c) => {
				const r = (
					await c.query(
						'SELECT email,in_app AS "inApp",locale,email_suppressed AS suppressed,version FROM foundation.notification_preferences WHERE user_id=$1',
						[a.userId],
					)
				).rows[0];
				return (
					r ?? {
						email: false,
						inApp: true,
						locale: "en",
						suppressed: false,
						version: 0,
					}
				);
			});
		},
		async setPreferences(
			a: TenantActor,
			i: {
				email: boolean;
				inApp: boolean;
				locale: "en" | "es";
				version: number;
			},
		) {
			return own(a, null, async (c) => {
				const r = (
					await c.query(
						`INSERT INTO foundation.notification_preferences(user_id,email,in_app,locale) SELECT $1,$2,$3,$4 WHERE $5=0 OR EXISTS(SELECT 1 FROM foundation.notification_preferences WHERE user_id=$1 AND version=$5) ON CONFLICT(user_id) DO UPDATE SET email=$2,in_app=$3,locale=$4,version=notification_preferences.version+1 WHERE notification_preferences.version=$5 RETURNING version`,
						[a.userId, i.email, i.inApp, i.locale, i.version],
					)
				).rows[0];
				if (!r) throw new ResourceError("CONFLICT");
				return { version: r.version as number };
			});
		},
		async list(a: TenantActor, org: string) {
			return own(a, org, async (c) => {
				const p = (
					await c.query(
						"SELECT in_app FROM foundation.notification_preferences WHERE user_id=$1",
						[a.userId],
					)
				).rows[0];
				if (p?.in_app === false) return [];
				return (
					await c.query(
						'SELECT id,kind,reference_id AS "referenceId",read_at,created_at FROM tenancy.notifications WHERE organization_id=$1 AND user_id=$2 AND expires_at>clock_timestamp() ORDER BY created_at DESC,id DESC LIMIT 50',
						[org, a.userId],
					)
				).rows.map((r) => ({
					id: r.id as string,
					kind: "bulk.completed" as const,
					referenceId: r.referenceId as string,
					read: r.read_at !== null,
					createdAt: r.created_at.toISOString(),
				}));
			});
		},
		async markRead(a: TenantActor, org: string, id: string) {
			return own(a, org, async (c) => {
				await c.query(
					"UPDATE tenancy.notifications SET read_at=coalesce(read_at,clock_timestamp()) WHERE organization_id=$1 AND user_id=$2 AND id=$3",
					[org, a.userId, id],
				);
				return { ok: true as const };
			});
		},
		async unsubscribe(receipt: string) {
			const [encoded, signature, ...extra] = receipt.split(".");
			if (!encoded || !signature || extra.length || receipt.length > 400)
				throw new ResourceError("DENIED");
			const user = Buffer.from(encoded, "base64url").toString();
			const expected = token(user).split(".")[1];
			if (
				signature.length !== expected.length ||
				!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
			)
				throw new ResourceError("DENIED");
			await suppress(user);
			return { ok: true as const };
		},
		/** Trusted signed provider callback resolves only a previously issued optional notification ID. */
		async feedback(id: string) {
			const rows = (
				await pool.query<{ user_id: string }>(
					"SELECT * FROM foundation.notification_recipient($1)",
					[id],
				)
			).rows;
			for (const r of rows) await suppress(r.user_id);
			return { ok: true as const };
		},
		async deliver(org: string) {
			const due = await withTenantTransaction(pool, org, [], false, (c) =>
				c.query<{ id: string; user_id: string }>(
					"SELECT id,user_id FROM tenancy.notifications WHERE organization_id=$1 AND email_state='pending' AND available_at<=clock_timestamp() ORDER BY available_at LIMIT 5",
					[org],
				),
			);
			for (const job of due.rows) {
				await withTenantTransaction(
					pool,
					org,
					[job.user_id],
					false,
					async (c) => {
						await options.ready(c);
						await c.query(
							"SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
							[`notification:${job.user_id}`],
						);
						const n = (
							await c.query(
								"SELECT * FROM tenancy.notifications WHERE organization_id=$1 AND id=$2 AND email_state='pending' FOR UPDATE SKIP LOCKED",
								[org, job.id],
							)
						).rows[0];
						if (!n) return;
						const pref = (
								await c.query(
									"SELECT * FROM foundation.notification_preferences WHERE user_id=$1",
									[job.user_id],
								)
							).rows[0],
							u = (
								await c.query("SELECT * FROM identity.lookup_user($1)", [
									job.user_id,
								])
							).rows[0];
						const member = (
							await c.query(
								"SELECT 1 FROM tenancy.memberships m JOIN tenancy.organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) AND o.status='active'",
								[org, job.user_id],
							)
						).rowCount;
						if (
							!pref?.email ||
							pref.email_suppressed ||
							u?.lifecycle_status !== "active" ||
							!u?.email_verified ||
							!member ||
							n.expires_at <= new Date()
						) {
							await c.query(
								"UPDATE tenancy.notifications SET email_state='skipped' WHERE organization_id=$1 AND id=$2",
								[org, job.id],
							);
							return;
						}
						if (!options.send) return;
						let success = false;
						try {
							await options.send({
								id: job.id,
								to: u.email,
								locale: pref.locale,
								organizationId: org,
								unsubscribe: token(job.user_id),
							});
							success = true;
						} catch {}
						await options.ready(c);
						await c.query(
							"UPDATE tenancy.notifications SET email_state=$3,attempts=attempts+1,available_at=clock_timestamp()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)) WHERE organization_id=$1 AND id=$2",
							[
								org,
								job.id,
								success ? "delivered" : n.attempts >= 7 ? "failed" : "pending",
							],
						);
						if (success)
							await appendTenantAudit(
								c,
								org,
								"system",
								"notification.delivered",
								job.id,
								{},
								undefined,
							);
					},
					undefined,
					false,
				);
			}
			await withTenantTransaction(pool, org, [], false, (c) =>
				c.query(
					"DELETE FROM tenancy.notifications WHERE organization_id=$1 AND expires_at<clock_timestamp()",
					[org],
				),
			);
		},
	};
}
