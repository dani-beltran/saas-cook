import { requireOperatorRequest } from "@saas-cook/auth/operator-network";
import { expect, it, vi } from "vitest";
import { publicRequest } from "./request";

vi.mock("@saas-cook/config/backoffice", () => ({
	backofficeConfig: () => ({ BACKOFFICE_ORIGIN: "https://staff.example.test" }),
}));
it("restores the configured origin without trusting forwarded hosts or losing the body", async () => {
	const origin = "https://staff.example.test";
	const r = new Request("http://localhost:3103/api/lookup?q=1", {
		method: "POST",
		body: '{"caseReference":"TEST"}',
		headers: {
			host: "staff.example.test",
			origin,
			"x-forwarded-host": "attacker.test",
			"x-forwarded-proto": "http",
		},
	});
	const restored = publicRequest(r);
	expect(restored.url).toBe(origin + "/api/lookup?q=1");
	expect(() => requireOperatorRequest(restored, { origin })).not.toThrow();
	expect(await restored.json()).toEqual({ caseReference: "TEST" });
	for (const host of [undefined, "attacker.test"]) {
		expect(() =>
			publicRequest(
				new Request("http://localhost/", {
					headers: {
						...(host ? { host } : {}),
						"x-forwarded-host": "staff.example.test",
					},
				}),
			),
		).toThrow("Invalid host");
	}
});
