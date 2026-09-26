import { describe, expect, it } from "vitest";
import {
	requireFreshAssurance,
	type SessionIdentity,
	safeDestination,
} from "./index";

describe("identity assurance boundary", () => {
	it("rejects external destinations and parser differentials", () => {
		for (const destination of [
			"https://evil.test",
			"//evil.test",
			"/\\evil.test",
			"/\nfoo",
			"/%2f%2fevil.test",
			"/%255cevil.test",
		])
			expect(() =>
				safeDestination(destination, "https://auth.example.test"),
			).toThrow();
		expect(
			safeDestination("/en/account?tab=security", "https://auth.example.test"),
		).toBe("/en/account?tab=security");
	});
	it("requires recent verified server evidence, not email possession", () => {
		const now = new Date();
		const actor: SessionIdentity = {
			userId: "user",
			sessionId: "session",
			email: "synthetic@example.test",
			name: "Synthetic",
			method: "magic-link",
			authenticatedAt: now,
			mfa: false,
			userVerified: false,
			credentialEpoch: 1,
			recoveryEpoch: "epoch",
			twoFactorEnabled: false,
		};
		expect(() => requireFreshAssurance(actor, { mfa: true, now })).toThrow();
		expect(() =>
			requireFreshAssurance({ ...actor, mfa: true }, { mfa: true, now }),
		).not.toThrow();
		expect(() =>
			requireFreshAssurance(
				{ ...actor, authenticatedAt: new Date(now.getTime() - 300001) },
				{ now },
			),
		).toThrow();
		expect(() =>
			requireFreshAssurance(
				{ ...actor, authenticatedAt: new Date(now.getTime() + 1) },
				{ now },
			),
		).toThrow();
	});
});
