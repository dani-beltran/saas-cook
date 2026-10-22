import { organizationDirectoryInput } from "@saas-cook/backoffice-contracts";
import { describe, expect, it } from "vitest";
import { directoryCursor } from "./directory-cursor";

describe("staff directory cursors", () => {
	it("encrypts positions and rejects tampering, wrong binding, rotated keys and expiry", () => {
		const codec = directoryCursor("synthetic_staff_secret_0000000000000000");
		const value = {
			version: 1 as const,
			binding: "actor-session-scope-query",
			after: "11111111-1111-4111-8111-111111111111",
			expiresAt: 1000,
		};
		const token = codec.seal(value);
		expect(codec.open(token, value.binding, 999)).toEqual(value);
		expect(Buffer.from(token, "base64url").toString()).not.toContain(
			value.after,
		);
		const bytes = Buffer.from(token, "base64url");
		bytes[30] ^= 1;
		expect(() =>
			codec.open(bytes.toString("base64url"), value.binding, 999),
		).toThrow();
		expect(() => codec.open(token, "another-context", 999)).toThrow();
		expect(() => codec.open(token, value.binding, 1000)).toThrow();
		expect(() =>
			directoryCursor("another_secret").open(token, value.binding, 999),
		).toThrow();
	});
	it("rejects personal search, unknown filters and unbounded pages", () => {
		const query = { caseReference: "CASE-1", pageSize: 50 };
		expect(organizationDirectoryInput.parse(query)).toEqual(query);
		expect(
			organizationDirectoryInput.parse({
				...query,
				organizationId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
			}).organizationId,
		).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
		for (const extra of [
			{ pageSize: 51 },
			{ pageSize: 0 },
			{ name: "secret" },
			{ lifecycle: "unknown" },
			{ organizationId: "partial" },
			{ sort: "email" },
		]) {
			expect(
				organizationDirectoryInput.safeParse({ ...query, ...extra }).success,
			).toBe(false);
		}
	});
});
