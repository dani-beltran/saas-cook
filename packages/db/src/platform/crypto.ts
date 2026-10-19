import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
export function privatePayloads(secret: string) {
	if (secret.length < 32) throw new Error("Private payload key required");
	const key = createHash("sha256").update(`platform-v1:${secret}`).digest();
	return {
		seal(value: string, scope: string) {
			const iv = randomBytes(12),
				c = createCipheriv("aes-256-gcm", key, iv);
			c.setAAD(Buffer.from(scope));
			return Buffer.concat([
				iv,
				c.update(value, "utf8"),
				c.final(),
				c.getAuthTag(),
			]).toString("base64url");
		},
		open(value: string, scope: string) {
			const b = Buffer.from(value, "base64url");
			if (b.length < 28 || b.length > 2000000)
				throw new Error("Invalid private payload");
			const c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
			c.setAAD(Buffer.from(scope));
			c.setAuthTag(b.subarray(-16));
			return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString(
				"utf8",
			);
		},
	};
}
