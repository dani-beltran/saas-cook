import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ingressSource } from "./ingress";

const secret = "synthetic-independent-ingress-secret-32-characters";
const now = 1790000000000;
function signed(source = "192.0.2.10", timestamp = String(now / 1000)) {
	const request = new Request("https://auth.example.test/api/auth/register", {
		method: "POST",
	});
	request.headers.set("x-common-saas-source", source);
	request.headers.set("x-common-saas-source-time", timestamp);
	request.headers.set(
		"x-common-saas-source-signature",
		createHmac("sha256", secret)
			.update(
				`common-saas-ingress:v1\n${timestamp}\nPOST\n/api/auth/register\n${source}`,
			)
			.digest("hex"),
	);
	return request;
}
describe("authenticated ingress source", () => {
	it("accepts only fresh canonical IP claims bound to the request method and route", () => {
		expect(ingressSource(signed(), secret, now)).toBe("192.0.2.10");
		expect(ingressSource(signed("2001:db8::1"), secret, now)).toBe(
			"2001:db8::1",
		);
		expect(
			ingressSource(signed("2001:0db8:0:0:0:0:0:1"), secret, now),
		).toBeNull();
		expect(ingressSource(signed("2001:DB8::1"), secret, now)).toBeNull();
		expect(ingressSource(signed("not-an-ip"), secret, now)).toBeNull();
		expect(ingressSource(signed("fe80::1%eth0"), secret, now)).toBeNull();
		expect(
			ingressSource(signed("192.0.2.10", String(now / 1000 - 31)), secret, now),
		).toBeNull();
		expect(
			ingressSource(signed("192.0.2.10", String(now / 1000 + 6)), secret, now),
		).toBeNull();
		const original = signed();
		expect(
			ingressSource(
				new Request("https://auth.example.test/api/auth/sign-in/magic-link", {
					method: "POST",
					headers: original.headers,
				}),
				secret,
				now,
			),
		).toBeNull();
		expect(
			ingressSource(
				new Request(original.url, { headers: original.headers }),
				secret,
				now,
			),
		).toBeNull();
	});
	it("ignores spoofed forwarding headers and fails closed on missing or forged attestations", () => {
		const request = signed();
		request.headers.set("x-forwarded-for", "192.0.2.20");
		request.headers.set("forwarded", "for=192.0.2.30");
		expect(ingressSource(request, secret, now)).toBe("192.0.2.10");
		expect(ingressSource(request, undefined, now)).toBe("unattributed");
		request.headers.set("x-common-saas-source", "192.0.2.20");
		expect(ingressSource(request, secret, now)).toBeNull();
		request.headers.set("x-common-saas-source-signature", "bad");
		expect(ingressSource(request, secret, now)).toBeNull();
		expect(ingressSource(new Request(request.url), secret, now)).toBeNull();
	});
});
