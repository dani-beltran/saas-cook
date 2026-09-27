import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { ResourceError } from "../resources";

type Position = { id: string; value: string; empty: boolean };
/** Feature-specific, authenticated opaque cursor; never expose contact sort values. */
export function customerCursors(secret: string) {
	const key = createHash("sha256")
		.update(`example-customers:${secret}`)
		.digest();
	return {
		encode(binding: string, position: Position) {
			const iv = randomBytes(12),
				cipher = createCipheriv("aes-256-gcm", key, iv);
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
		decode(value: string, binding: string): Position {
			try {
				if (!/^[A-Za-z0-9_-]{40,2048}$/.test(value)) throw new Error();
				const bytes = Buffer.from(value, "base64url");
				if (bytes.toString("base64url") !== value) throw new Error();
				const cipher = createDecipheriv(
					"aes-256-gcm",
					key,
					bytes.subarray(0, 12),
				);
				cipher.setAuthTag(bytes.subarray(-16));
				const parsed = JSON.parse(
					Buffer.concat([
						cipher.update(bytes.subarray(12, -16)),
						cipher.final(),
					]).toString(),
				);
				const p = parsed.position;
				if (
					parsed.binding !== binding ||
					typeof parsed.expires !== "number" ||
					parsed.expires <= Date.now() ||
					!p ||
					typeof p.value !== "string" ||
					p.value.length > 120 ||
					typeof p.empty !== "boolean" ||
					!/^[0-9a-f-]{36}$/.test(p.id)
				)
					throw new Error();
				return p;
			} catch {
				throw new ResourceError("INVALID");
			}
		},
	};
}
