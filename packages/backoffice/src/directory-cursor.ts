import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
} from "node:crypto";
import { z } from "zod";

const payload = z.strictObject({
	version: z.literal(1),
	binding: z.string(),
	after: z.uuid(),
	expiresAt: z.number().int(),
});
const purpose = "backoffice.organization-directory.cursor.v1";

/**
 * Creates an AES-GCM cursor codec from the staff secret using a separate HKDF purpose.
 * Callers bind session, installation, epoch, current grants and normalized query.
 * Tokens expire at the supplied deadline; open throws on tampering, reuse in a
 * different context or expiry. Rotation of the staff secret invalidates all tokens.
 */
export function directoryCursor(secret: string) {
	const key = Buffer.from(hkdfSync("sha256", secret, purpose, purpose, 32));
	return {
		seal(value: z.infer<typeof payload>) {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			cipher.setAAD(Buffer.from(purpose));
			const encrypted = Buffer.concat([
				cipher.update(JSON.stringify(payload.parse(value))),
				cipher.final(),
			]);
			return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
				"base64url",
			);
		},
		open(token: string, binding: string, now: number) {
			if (token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token))
				throw new Error("Invalid cursor");
			const bytes = Buffer.from(token, "base64url");
			if (bytes.length < 29 || bytes.toString("base64url") !== token)
				throw new Error("Invalid cursor");
			const decipher = createDecipheriv(
				"aes-256-gcm",
				key,
				bytes.subarray(0, 12),
			);
			decipher.setAAD(Buffer.from(purpose));
			decipher.setAuthTag(bytes.subarray(12, 28));
			const value = payload.parse(
				JSON.parse(
					Buffer.concat([
						decipher.update(bytes.subarray(28)),
						decipher.final(),
					]).toString("utf8"),
				),
			);
			if (value.binding !== binding || value.expiresAt <= now)
				throw new Error("Expired or mismatched cursor");
			return value;
		},
	};
}
