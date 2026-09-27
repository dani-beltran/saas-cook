import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
	avatarUploadLimit,
	boundedBody,
	normalizeAvatar,
	PersonalSettingsError,
} from "./avatar";
import type { SessionIdentity } from "./index";

const mode = z.enum(["light", "dark", "system"]);
const themeInput = z.strictObject({
	mode,
	expectedVersion: z.number().int().min(0).max(2147483646),
});
const avatarInput = z.strictObject({
	expectedVersion: z.uuid().toLowerCase().nullable(),
	operationKey: z.uuid().toLowerCase(),
});
export type PersonalSettings = {
	userId: string;
	mode: z.infer<typeof mode> | null;
	themeVersion: number;
	image: string | null;
	avatarVersion: string | null;
};
const headers = {
	"Cache-Control": "private, no-store",
	Vary: "Cookie",
	"X-Content-Type-Options": "nosniff",
	"Cross-Origin-Resource-Policy": "same-origin",
	"Referrer-Policy": "no-referrer",
};
const json = (value: unknown, status = 200) =>
	Response.json(value, { status, headers });

export function createPersonalSettings(
	pool: Pool,
	identity: {
		origin: string;
		session: (headers: Headers) => Promise<SessionIdentity | null>;
		assertCurrent: (actor: SessionIdentity) => Promise<Date>;
		throttle: (key: string, max: number) => Promise<boolean>;
	},
) {
	async function transaction<T>(
		actor: SessionIdentity,
		work: (client: PoolClient) => Promise<T>,
	) {
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='8s'",
			);
			await client.query(
				"SELECT pg_advisory_xact_lock_shared(hashtextextended('user:'||$1,0))",
				[actor.userId],
			);
			const deadline = await identity.assertCurrent(actor);
			const result = await work(client);
			// Server-time guard spans all SQL, row-lock waits and readiness checks.
			await identity.assertCurrent(actor);
			if (
				!(await client.query("SELECT 1 WHERE clock_timestamp()<$1", [deadline]))
					.rowCount
			)
				throw new PersonalSettingsError(401, "session_expired");
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
	async function state(
		client: PoolClient,
		userId: string,
	): Promise<PersonalSettings> {
		const row = (
			await client.query(
				`SELECT u.theme_mode,u.theme_version,u.image,a.version FROM identity."user" u
LEFT JOIN identity.user_avatar a ON a.user_id=u.id WHERE u.id=$1`,
				[userId],
			)
		).rows[0];
		return {
			userId,
			mode: mode.nullable().parse(row.theme_mode),
			themeVersion: row.theme_version,
			image: row.image,
			avatarVersion: row.version ?? null,
		};
	}
	async function read(requestHeaders: Headers) {
		if (requestHeaders.has("authorization")) return null;
		const actor = await identity.session(requestHeaders);
		return actor
			? transaction(actor, (client) => state(client, actor.userId))
			: null;
	}
	async function handle(request: Request): Promise<Response> {
		try {
			const url = new URL(request.url);
			const avatar = url.pathname === "/api/auth/avatar";
			if (request.headers.has("authorization"))
				return json({ error: "session_required" }, 401);
			if (!["GET", "POST"].includes(request.method))
				return json({ error: "method_not_allowed" }, 405);
			if (
				request.method === "POST" &&
				request.headers.get("origin") !== identity.origin
			)
				return json({ error: "forbidden" }, 403);
			const actor = await identity.session(request.headers);
			if (!actor) return json({ error: "session_required" }, 401);
			if (
				request.method === "POST" &&
				request.headers.get("x-personal-user") !== actor.userId
			)
				return json({ error: "account_changed" }, 409);
			if (request.method === "GET")
				return await transaction(actor, async (client) => {
					if (!avatar) return json(await state(client, actor.userId));
					const version = z
						.uuid()
						.toLowerCase()
						.safeParse(url.searchParams.get("version"));
					if (!version.success) return json({ error: "not_found" }, 404);
					const row = (
						await client.query(
							`SELECT a.bytes FROM identity.user_avatar a JOIN identity."user" u ON u.id=a.user_id
WHERE a.user_id=$1 AND a.version=$2 AND u.image=$3`,
							[
								actor.userId,
								version.data,
								`/api/auth/avatar?version=${version.data}`,
							],
						)
					).rows[0];
					return row?.bytes
						? new Response(new Uint8Array(row.bytes), {
								headers: {
									...headers,
									"Content-Type": "image/webp",
									"Content-Disposition": "inline; filename=avatar.webp",
								},
							})
						: json({ error: "not_found" }, 404);
				});
			if (!(await identity.throttle(`personal:${actor.userId}`, 30)))
				return json({ error: "rate_limited" }, 429);
			const contentType = request.headers.get("content-type");
			const upload =
				avatar &&
				["image/jpeg", "image/png", "image/webp"].includes(contentType ?? "");
			if (!upload && contentType !== "application/json")
				return json({ error: "invalid_input" }, 415);
			const body = upload
				? null
				: JSON.parse((await boundedBody(request, 1024)).toString("utf8"));
			const parsedTheme = !avatar ? themeInput.parse(body) : null;
			const parsedAvatar = avatar
				? avatarInput.parse(
						upload
							? {
									expectedVersion:
										request.headers.get("x-avatar-version") === "none"
											? null
											: request.headers.get("x-avatar-version"),
									operationKey: request.headers.get("x-operation-key"),
								}
							: body,
					)
				: null;
			// Decode before taking locks; revalidate the session under the lifecycle fence afterward.
			const bytes = upload
				? await normalizeAvatar(await boundedBody(request, avatarUploadLimit))
				: null;
			return await transaction(actor, async (client) => {
				await client.query(
					'SELECT id FROM identity."user" WHERE id=$1 FOR UPDATE',
					[actor.userId],
				);
				const current = await state(client, actor.userId);
				if (parsedTheme) {
					if (current.mode === parsedTheme.mode) return json(current);
					if (current.themeVersion !== parsedTheme.expectedVersion)
						return json({ error: "conflict" }, 409);
					await client.query(
						'UPDATE identity."user" SET theme_mode=$2,theme_version=theme_version+1,updated_at=now() WHERE id=$1',
						[actor.userId, parsedTheme.mode],
					);
				} else if (parsedAvatar) {
					if (bytes && current.avatarVersion === parsedAvatar.operationKey) {
						const stored = (
							await client.query(
								"SELECT bytes FROM identity.user_avatar WHERE user_id=$1",
								[actor.userId],
							)
						).rows[0];
						return stored.bytes?.equals(bytes)
							? json(current)
							: json({ error: "conflict" }, 409);
					}
					if (
						!bytes &&
						current.avatarVersion === parsedAvatar.operationKey &&
						!current.image
					)
						return json(current);
					if (current.avatarVersion !== parsedAvatar.expectedVersion)
						return json({ error: "conflict" }, 409);
					if (bytes) {
						await client.query(
							`INSERT INTO identity.user_avatar(user_id,version,bytes) VALUES($1,$2,$3)
ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,bytes=EXCLUDED.bytes`,
							[actor.userId, parsedAvatar.operationKey, bytes],
						);
					} else
						await client.query(
							"INSERT INTO identity.user_avatar(user_id,version,bytes) VALUES($1,$2,NULL) ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,bytes=NULL",
							[actor.userId, parsedAvatar.operationKey],
						);
					await client.query(
						'UPDATE identity."user" SET image=$2,updated_at=now() WHERE id=$1',
						[
							actor.userId,
							bytes
								? `/api/auth/avatar?version=${parsedAvatar.operationKey}`
								: null,
						],
					);
				}
				await client.query(
					"INSERT INTO identity.security_audit(id,user_id,action) VALUES($1,$2,$3)",
					[
						randomUUID(),
						actor.userId,
						parsedTheme
							? "identity.theme.updated"
							: bytes
								? "identity.avatar.updated"
								: "identity.avatar.removed",
					],
				);
				return json(await state(client, actor.userId));
			});
		} catch (error) {
			if (error instanceof PersonalSettingsError)
				return json({ error: error.code }, error.status);
			if (error instanceof z.ZodError || error instanceof SyntaxError)
				return json({ error: "invalid_input" }, 400);
			return json({ error: "unavailable" }, 503);
		}
	}
	return { read, handle };
}
