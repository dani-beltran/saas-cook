import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { z } from "zod";
import { ResourceError } from "../resources";

const positionSchema = z.strictObject({
	id: z.uuid(),
	value: z.string().max(120),
});
export type Position = z.infer<typeof positionSchema>;
/** Distinct namespace, encrypted positions, canonical encoding and bounded lifetime. */
export function platformCursors(secret: string) {
	const key = createHash("sha256").update(`platform-v1:${secret}`).digest();
	return {
		encode(binding: string, position: Position) {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			return Buffer.concat([
				iv,
				cipher.update(
					JSON.stringify({
						binding,
						position,
						expires: Date.now() + 30 * 60_000,
					}),
				),
				cipher.final(),
				cipher.getAuthTag(),
			]).toString("base64url");
		},
		decode(token: string, binding: string): Position {
			try {
				if (!/^[A-Za-z0-9_-]{40,2048}$/.test(token)) throw new Error();
				const bytes = Buffer.from(token, "base64url");
				if (bytes.toString("base64url") !== token) throw new Error();
				const decipher = createDecipheriv(
					"aes-256-gcm",
					key,
					bytes.subarray(0, 12),
				);
				decipher.setAuthTag(bytes.subarray(-16));
				const value = JSON.parse(
					Buffer.concat([
						decipher.update(bytes.subarray(12, -16)),
						decipher.final(),
					]).toString(),
				);
				if (
					value.binding !== binding ||
					!Number.isFinite(value.expires) ||
					value.expires <= Date.now()
				)
					throw new Error();
				return positionSchema.parse(value.position);
			} catch {
				throw new ResourceError("INVALID");
			}
		},
	};
}
