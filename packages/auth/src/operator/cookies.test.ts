import { getCookies } from "better-auth/cookies";
import { expect, it } from "vitest";
import { operatorCookies } from "./cookies";

it("uses the exact Host-prefix session name and Secure host-only attributes under HTTPS", () => {
	const origin = "https://staff.example.test";
	const cookies = getCookies({
		baseURL: origin,
		advanced: operatorCookies(origin),
	});
	expect(cookies.sessionToken.name).toBe("__Host-backoffice-session");
	for (const cookie of Object.values(cookies)) {
		expect(cookie.attributes).toMatchObject({
			secure: true,
			httpOnly: true,
			sameSite: "strict",
			path: "/",
		});
		expect(cookie.attributes.domain).toBeUndefined();
	}
	const local = getCookies({
		baseURL: "http://localhost:3103",
		advanced: operatorCookies("http://localhost:3103"),
	});
	expect(local.sessionToken.name).toBe("backoffice-session");
	expect(local.sessionToken.attributes.secure).toBe(false);
});
