import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { operatorNetworks, requireOperatorIngress } from "./network";

const origin = "https://staff.example.test",
	secret = "test_ingress_secret_00000000000000000000";
function request(
	source = "127.0.0.1",
	path = "/api/lookup",
	time = Date.now(),
) {
	const timestamp = String(Math.floor(time / 1000));
	return new Request(origin + path, {
		method: "POST",
		headers: {
			origin,
			"x-backoffice-source": source,
			"x-backoffice-time": timestamp,
			"x-backoffice-signature": createHmac("sha256", secret)
				.update(
					`backoffice-ingress:v1\n${origin}\nPOST\n${path}\n${timestamp}\n${source}`,
				)
				.digest("hex"),
		},
	});
}
describe("operator ingress", () => {
	const options = {
		origin,
		secret,
		networks: operatorNetworks(["127.0.0.0/8", "2001:db8::/32"]),
	};
	it("admits signed IPv4 and IPv6 sources and denies network/expiry/path/origin substitution", () => {
		for (const ip of ["127.0.0.1", "2001:db8::1"])
			expect(requireOperatorIngress(request(ip), options)).toBe(ip);
		expect(() =>
			requireOperatorIngress(request("192.0.2.1"), options),
		).toThrow();
		expect(() =>
			requireOperatorIngress(
				request("127.0.0.1", "/api/lookup", Date.now() - 60000),
				options,
			),
		).toThrow();
		const r = request();
		expect(() =>
			requireOperatorIngress(new Request(`${origin}/other`, r), options),
		).toThrow();
		r.headers.set("origin", "https://customer.example.test");
		expect(() => requireOperatorIngress(r, options)).toThrow();
	});
	it("rejects missing/spoofed/ambiguous signatures and invalid policy", () => {
		const r = request();
		r.headers.delete("x-backoffice-signature");
		r.headers.set("x-forwarded-for", "127.0.0.1");
		expect(() => requireOperatorIngress(r, options)).toThrow();
		expect(() => operatorNetworks([])).toThrow();
		expect(() => operatorNetworks(["127.0.0.1/33"])).toThrow();
		expect(() =>
			requireOperatorIngress(request("fe80::1%lo"), options),
		).toThrow();
	});
});
