import { createHmac } from "node:crypto";
import {
	operatorNetworks,
	requireOperatorIngress,
} from "@saas-cook/auth/operator-network";
import { expect, it, vi } from "vitest";
import { publicRequest } from "./request";

vi.mock("@saas-cook/config/backoffice", () => ({
	backofficeConfig: () => ({ BACKOFFICE_ORIGIN: "https://staff.example.test" }),
}));
it("restores TLS termination without trusting forwarded hosts or dropping body/signature checks", async () => {
	const origin = "https://staff.example.test",
		secret = "synthetic-ingress-secret",
		time = String(Math.floor(Date.now() / 1000));
	const r = new Request("http://localhost:3103/api/lookup?q=1", {
		method: "POST",
		body: '{"caseReference":"TEST"}',
		headers: {
			host: "staff.example.test",
			origin,
			"x-forwarded-host": "attacker.test",
			"x-forwarded-proto": "http",
			"x-backoffice-source": "127.0.0.1",
			"x-backoffice-time": time,
			"x-backoffice-signature": createHmac("sha256", secret)
				.update(
					`backoffice-ingress:v1\n${origin}\nPOST\n/api/lookup?q=1\n${time}\n127.0.0.1`,
				)
				.digest("hex"),
		},
	});
	const restored = publicRequest(r);
	expect(restored.url).toBe(`${origin}/api/lookup?q=1`);
	expect(
		requireOperatorIngress(restored, {
			origin,
			secret,
			networks: operatorNetworks(["127.0.0.1/32"]),
		}),
	).toBe("127.0.0.1");
	expect(await restored.json()).toEqual({ caseReference: "TEST" });
	expect(() =>
		publicRequest(
			new Request("http://localhost/", {
				headers: {
					host: "attacker.test",
					"x-forwarded-host": "staff.example.test",
				},
			}),
		),
	).toThrow();
});
