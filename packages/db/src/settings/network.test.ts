import { expect, it } from "vitest";
import { evaluateFlag } from "./flags";
import { endpointUrl, publicAddress } from "./network";
import { webhookSignature } from "./service";

it("rejects private, metadata, mapped and reserved network destinations", () => {
	for (const ip of [
		"127.0.0.1",
		"10.0.0.1",
		"169.254.169.254",
		"192.168.1.2",
		"::1",
		"::ffff:8.8.8.8",
		"fc00::1",
		"2001:db8::1",
		"2002:7f00:1::",
	])
		expect(publicAddress(ip), ip).toBe(false);
	expect(publicAddress("8.8.8.8")).toBe(true);
	expect(publicAddress("2606:4700::1111")).toBe(true);
	for (const url of [
		"http://example.com",
		"https://example.com:8080",
		"https://example.com?token=x",
		"https://secret@example.com",
		"https://other.example",
	])
		expect(() => endpointUrl(url, ["example.com"])).toThrow();
	expect(
		endpointUrl("https://example.com/events", ["example.com"]).pathname,
	).toBe("/events");
});
it("binds webhook signatures to delivery, payload and time", () => {
	const signed = webhookSignature("synthetic", "one", "payload", 123);
	expect(signed).not.toBe(webhookSignature("synthetic", "two", "payload", 123));
	expect(signed).not.toBe(webhookSignature("synthetic", "one", "payload", 124));
});
it("fails closed for missing/expired flags and applies stable tenant rollout and exclusions", () => {
	const config = {
		key: "help.contact" as const,
		enabled: true,
		owner: "platform",
		percent: 100,
		organizations: [],
		excluded: ["org"],
		environment: "test" as const,
		expiresAt: "2027-01-01T00:00:00Z",
		version: 1,
	};
	expect(evaluateFlag(null, "help.contact", "org", "test")).toBe(false);
	expect(evaluateFlag(config, "help.contact", "org", "test")).toBe(false);
	expect(evaluateFlag(config, "help.contact", "other", "production")).toBe(
		false,
	);
	expect(
		evaluateFlag(
			config,
			"help.contact",
			"other",
			"test",
			new Date("2026-01-01"),
		),
	).toBe(true);
	expect(
		evaluateFlag(
			config,
			"help.contact",
			"other",
			"test",
			new Date("2027-01-02"),
		),
	).toBe(false);
});
