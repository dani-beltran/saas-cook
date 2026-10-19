import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { intersectLimits, normalizeAccess, planSchema } from "./policy";
import { createStripeProvider, stripeApiVersion } from "./stripe";
import { monthWindow } from "./usage";

describe("commercial policy", () => {
	it("keeps free, pending, trial, paid, grace and canceled states distinct at exact boundaries", () => {
		const now = new Date("2026-09-27T00:00:00Z"),
			future = new Date(now.getTime() + 1000);
		const base = {
			trialEnd: future,
			periodEnd: future,
			graceEnd: future,
			cancelAt: null,
		};
		for (const [status, expected] of [
			["none", "free"],
			["incomplete", "pending"],
			["trialing", "trial"],
			["active", "active"],
			["past_due", "grace"],
			["unpaid", "restricted"],
			["paused", "restricted"],
			["canceled", "canceled"],
			["incomplete_expired", "canceled"],
		])
			expect(normalizeAccess({ ...base, status }, now)).toBe(expected);
		expect(
			normalizeAccess({ ...base, status: "trialing", trialEnd: now }, now),
		).toBe("restricted");
		expect(
			normalizeAccess({ ...base, status: "past_due", graceEnd: now }, now),
		).toBe("restricted");
		expect(
			normalizeAccess({ ...base, status: "active", cancelAt: now }, now),
		).toBe("restricted");
	});
	it("preserves missing/disabled/zero/limited/unlimited when intersecting local and purchased rights", () => {
		expect(
			intersectLimits({ kind: "limited", limit: 0 }, { kind: "unlimited" }),
		).toEqual({ kind: "limited", limit: 0 });
		expect(
			intersectLimits(
				{ kind: "limited", limit: 100 },
				{ kind: "limited", limit: 4 },
			),
		).toEqual({ kind: "limited", limit: 4 });
		expect(
			intersectLimits({ kind: "disabled" }, { kind: "unlimited" }),
		).toEqual({ kind: "disabled" });
		expect(
			intersectLimits({ kind: "missing" }, { kind: "limited", limit: 4 }),
		).toEqual({ kind: "missing" });
	});
	it("rejects unstable sold version IDs and undeclared commercial fields", () => {
		expect(
			planSchema.safeParse({ id: "paid/v2", key: "paid", version: 1 }).success,
		).toBe(false);
	});
	it("uses UTC half-open windows including leap years and year rollover", () => {
		expect(monthWindow(new Date("2028-02-29T23:59:59.999Z"))).toEqual({
			start: new Date("2028-02-01Z"),
			end: new Date("2028-03-01Z"),
		});
		expect(
			monthWindow(new Date("2027-01-01T00:00:00Z")).start.toISOString(),
		).toBe("2027-01-01T00:00:00.000Z");
	});
	it("verifies raw bytes, rejects signature alteration/expiry and quarantines mode/version/account mismatches", () => {
		const secret = "whsec_synthetic",
			provider = createStripeProvider({
				secretKey: "sk_test_synthetic",
				accountId: "acct_synthetic",
				mode: "test",
				webhookSecret: secret,
				portalConfigurationId: "bpc_synthetic",
			}),
			stripe = new Stripe("sk_test_synthetic");
		const event = {
			id: "evt_synthetic",
			type: "customer.subscription.updated",
			livemode: false,
			api_version: stripeApiVersion,
			data: { object: { customer: "cus_synthetic" } },
		};
		const encode = (e: object, timestamp?: number) => {
			const raw = JSON.stringify(e);
			return {
				raw: Buffer.from(raw),
				signature: stripe.webhooks.generateTestHeaderString({
					payload: raw,
					secret,
					timestamp,
				}),
			};
		};
		let v = encode(event);
		expect(provider.verify(v.raw, v.signature).quarantine).toBeNull();
		expect(() =>
			provider.verify(Buffer.from(`${v.raw} `), v.signature),
		).toThrow();
		v = encode(event, Math.floor(Date.now() / 1000) - 600);
		expect(() => provider.verify(v.raw, v.signature)).toThrow();
		for (const [change, reason] of [
			[{ livemode: true }, "mode"],
			[{ api_version: "2026-08-26.dahlia" }, "version"],
			[{ api_version: "old" }, "version"],
			[{ account: "acct_wrong" }, "account"],
		] as const) {
			v = encode({ ...event, ...change });
			expect(provider.verify(v.raw, v.signature).quarantine).toBe(reason);
		}
	});
});
