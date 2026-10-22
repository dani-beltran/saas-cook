import { describe, expect, it } from "vitest";
import { requireOperatorRequest } from "./network";

const origin = "https://staff.example.test";
describe("public operator request boundary", () => {
	it("accepts ordinary requests without source, signature or IP policy", () => {
		for (const method of ["GET", "HEAD", "POST"]) {
			expect(() =>
				requireOperatorRequest(
					new Request(origin + "/api/lookup", {
						method,
						headers: method === "POST" ? { origin } : {},
					}),
					{ origin },
				),
			).not.toThrow();
		}
	});
	it("ignores legacy and forwarded source headers", () => {
		for (const source of ["192.0.2.1", "2001:db8::1", "invalid, spoofed"]) {
			const request = new Request(origin, {
				headers: {
					"x-backoffice-source": source,
					"x-backoffice-signature": "invalid",
					"x-backoffice-time": "0",
					"x-forwarded-for": source,
					"cf-connecting-ip": source,
					"x-forwarded-host": "attacker.test",
				},
			});
			expect(() => requireOperatorRequest(request, { origin })).not.toThrow();
		}
	});
	it("rejects wrong URL/Host and bearer credentials", () => {
		for (const request of [
			new Request("https://attacker.test"),
			new Request(origin, { headers: { host: "attacker.test" } }),
			new Request(origin, {
				headers: { authorization: "Bearer customer-key" },
			}),
		])
			expect(() => requireOperatorRequest(request, { origin })).toThrow();
	});
	it("requires the exact origin for non-read requests", () => {
		for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
			for (const candidate of [
				undefined,
				"null",
				"https://customer.example.test",
				origin + ", https://attacker.test",
			]) {
				expect(() =>
					requireOperatorRequest(
						new Request(origin, {
							method,
							headers: candidate ? { origin: candidate } : {},
						}),
						{ origin },
					),
				).toThrow("Operator origin denied");
			}
		}
	});
});
