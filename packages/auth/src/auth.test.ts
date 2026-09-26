import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createIdentityAdapter } from "./index";

describe("isolated identity adapter setup", () => {
	it("rejects missing secrets and noncanonical/untrusted origins before connecting", async () => {
		const pool = new Pool();
		try {
			expect(() =>
				createIdentityAdapter(pool, {
					secret: "short",
					origin: "https://auth.example.test",
				}),
			).toThrow();
			expect(() =>
				createIdentityAdapter(pool, {
					secret: "a".repeat(32),
					origin: "http://auth.example.test",
				}),
			).toThrow();
			expect(() =>
				createIdentityAdapter(pool, {
					secret: "a".repeat(32),
					origin: "https://auth.example.test/path",
				}),
			).toThrow();
			const provider = createIdentityAdapter(pool, {
				secret: "synthetic-local-identity-secret-32-characters",
				origin: "http://localhost:3000",
			});
			expect(provider.options.emailAndPassword?.enabled).toBe(false);
			expect(provider.options.account?.accountLinking?.enabled).toBe(false);
			expect(provider.options.user?.deleteUser?.enabled).toBe(false);
		} finally {
			await pool.end();
		}
	});
});
