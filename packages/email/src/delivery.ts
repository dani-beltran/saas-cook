import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { renderIdentityEmail } from "./identity";

const payloadSchema = z.strictObject({
	to: z.email(),
	kind: z.enum([
		"verification",
		"reset",
		"password-reset",
		"magic-link",
		"invite",
		"transfer",
		"transfer-completed",
		"recovery",
	]),
	locale: z.enum(["en", "es"]),
	transfer: z.object({ fromEmail: z.email(), toEmail: z.email() }).optional(),
	url: z.url(),
});
export type IdentityEmail = z.infer<typeof payloadSchema>;
export type EmailTransport = (message: {
	to: string;
	subject: string;
	html: string;
	text: string;
	id: string;
}) => Promise<void>;
function key(secret: string) {
	if (secret.length < 32) throw new Error("Invalid email encryption key");
	return createHash("sha256")
		.update("identity-email:v1\0")
		.update(secret)
		.digest();
}
function protect(payload: IdentityEmail, secret: string, id: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
	cipher.setAAD(Buffer.from(id));
	const content = Buffer.concat([
		cipher.update(JSON.stringify(payload)),
		cipher.final(),
	]);
	return Buffer.concat([iv, cipher.getAuthTag(), content]).toString(
		"base64url",
	);
}
function unprotect(value: string, secret: string, id: string) {
	const data = Buffer.from(value, "base64url");
	const cipher = createDecipheriv(
		"aes-256-gcm",
		key(secret),
		data.subarray(0, 12),
	);
	cipher.setAAD(Buffer.from(id));
	cipher.setAuthTag(data.subarray(12, 28));
	return payloadSchema.parse(
		JSON.parse(
			Buffer.concat([
				cipher.update(data.subarray(28)),
				cipher.final(),
			]).toString(),
		),
	);
}
/** Protected, short-lived delivery data. Supply a transaction client for atomic domain events. */
export async function enqueueIdentityEmail(
	database: Pool | PoolClient,
	input: IdentityEmail & { secret: string; expiresAt: Date },
) {
	const payload = payloadSchema.parse({
		to: input.to,
		kind: input.kind,
		locale: input.locale,
		url: input.url,
		transfer: input.transfer,
	});
	if (input.expiresAt.getTime() <= Date.now())
		throw new Error("Expired identity message");
	const id = randomUUID();
	await database.query(
		"INSERT INTO identity.email_delivery(id,encrypted_payload,expires_at) VALUES($1,$2,$3)",
		[id, protect(payload, input.secret, id), input.expiresAt],
	);
	return id;
}
/** At-least-once SMTP delivery; stable Message-ID permits receiver deduplication. No payload logging. */
export async function deliverIdentityEmails(
	pool: Pool,
	options: { secret: string; transport: EmailTransport; limit?: number },
) {
	let delivered = 0;
	let failed = 0;
	const failures = {
		decrypt: 0,
		render: 0,
		transport: 0,
		receipt: 0,
		expired: 0,
	};
	for (let i = 0; i < (options.limit ?? 20); i++) {
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const row = (
				await client.query<{
					id: string;
					encrypted_payload: string;
					expires_at: Date;
					attempts: number;
				}>(
					"SELECT id,encrypted_payload,expires_at,attempts FROM identity.email_delivery WHERE delivered_at IS NULL AND failed_at IS NULL AND available_at<=now() ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1",
				)
			).rows[0];
			if (!row) {
				await client.query("COMMIT");
				break;
			}
			if (row.expires_at.getTime() <= Date.now()) {
				await client.query(
					"UPDATE identity.email_delivery SET failed_at=now(),encrypted_payload='' WHERE id=$1",
					[row.id],
				);
				await client.query("COMMIT");
				failed++;
				failures.expired++;
				continue;
			}
			let stage: keyof typeof failures = "decrypt";
			try {
				const payload = unprotect(
					row.encrypted_payload,
					options.secret,
					row.id,
				);
				stage = "render";
				const content = await renderIdentityEmail(payload);
				stage = "transport";
				await options.transport({ to: payload.to, ...content, id: row.id });
				stage = "receipt";
				await client.query(
					"UPDATE identity.email_delivery SET delivered_at=now(),encrypted_payload='',attempts=attempts+1 WHERE id=$1",
					[row.id],
				);
				delivered++;
			} catch {
				failures[stage]++;
				await client.query(
					"UPDATE identity.email_delivery SET attempts=attempts+1,available_at=now()+make_interval(secs=>LEAST(300,power(2,LEAST(attempts,8))::int)),failed_at=CASE WHEN attempts>=7 THEN now() ELSE NULL END,encrypted_payload=CASE WHEN attempts>=7 THEN '' ELSE encrypted_payload END WHERE id=$1",
					[row.id],
				);
				failed++;
			}
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
	// Expired and exhausted payloads are removed even if an SMTP worker was previously down.
	await pool.query(
		"DELETE FROM identity.email_delivery WHERE expires_at<now()-interval '1 day'",
	);
	return { delivered, failed, failures };
}
