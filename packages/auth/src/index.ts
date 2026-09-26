import { identitySchema } from "@common-saas/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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
/** Adapter setup only. Intentionally unmounted until Phase 2 supplies lifecycle,
 * assurance and recovery controls. A caller must use the isolated identity pool. */
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
