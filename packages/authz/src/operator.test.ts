import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileContext } from "./model";
import { type OperatorApproval, verifyOperatorApproval } from "./operator";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const now = Date.parse("2026-09-26T12:00:00.000Z");
function approval(overrides: Partial<OperatorApproval> = {}) {
	const claims: OperatorApproval = {
		version: 1,
		installationId: randomUUID(),
		epoch: randomUUID(),
		nonce: randomUUID(),
		operatorId: "independent-authority",
		organizationId: randomUUID(),
		subjectUserId: randomUUID(),
		scope: "owner:recover",
		evidenceReference: "case:verified-company-authority-123",
		mfaAt: new Date(now - 1000).toISOString(),
		expiresAt: new Date(now + 60000).toISOString(),
		subjectAuthenticatedAt: new Date(now - 1000).toISOString(),
		subjectMethod: "passkey",
		subjectMfa: true,
		...overrides,
	};
	const payload = Buffer.from(JSON.stringify(claims));
	const envelope = JSON.stringify({
		payload: payload.toString("base64url"),
		signature: sign(null, payload, privateKey).toString("base64url"),
	});
	return {
		claims,
		envelope,
		expected: {
			installationId: claims.installationId,
			epoch: claims.epoch,
			scope: claims.scope,
		},
	};
}
describe("independent operator approvals", () => {
	it("verifies a real Ed25519 signature with exact scope, epoch and fresh subject assurance", () => {
		const value = approval();
		expect(
			verifyOperatorApproval(value.envelope, publicPem, value.expected, now)
				.claims,
		).toEqual(value.claims);
	});
	it("rejects forged payloads/signatures and a different authority key", () => {
		const value = approval();
		const decoded = JSON.parse(value.envelope);
		decoded.payload = Buffer.from(
			JSON.stringify({ ...value.claims, subjectUserId: randomUUID() }),
		).toString("base64url");
		expect(() =>
			verifyOperatorApproval(
				JSON.stringify(decoded),
				publicPem,
				value.expected,
				now,
			),
		).toThrow();
		const wrong = generateKeyPairSync("ed25519")
			.publicKey.export({ type: "spki", format: "pem" })
			.toString();
		expect(() =>
			verifyOperatorApproval(value.envelope, wrong, value.expected, now),
		).toThrow();
	});
	it("rejects cross-tenant installation/epoch/scope claims and stale/future or absent assurance", () => {
		const value = approval();
		for (const expected of [
			{ ...value.expected, installationId: randomUUID() },
			{ ...value.expected, epoch: randomUUID() },
			{ ...value.expected, scope: "security:deactivate" as const },
		])
			expect(() =>
				verifyOperatorApproval(value.envelope, publicPem, expected, now),
			).toThrow();
		for (const overrides of [
			{ mfaAt: new Date(now + 1).toISOString() },
			{ mfaAt: new Date(now - 301000).toISOString() },
			{ expiresAt: new Date(now).toISOString() },
			{ expiresAt: new Date(now + 900000).toISOString() },
			{ subjectAuthenticatedAt: new Date(now + 1).toISOString() },
			{ subjectMfa: undefined },
		]) {
			const bad = approval(overrides);
			expect(() =>
				verifyOperatorApproval(bad.envelope, publicPem, bad.expected, now),
			).toThrow();
		}
	});
	it("requires a signed exact membership target for security deactivation", () => {
		const value = approval({
			scope: "security:deactivate",
			membershipId: randomUUID(),
			subjectAuthenticatedAt: undefined,
			subjectMethod: undefined,
			subjectMfa: undefined,
		});
		expect(
			verifyOperatorApproval(value.envelope, publicPem, value.expected, now)
				.claims.scope,
		).toBe("security:deactivate");
		const bad = approval({ scope: "security:deactivate" });
		expect(() =>
			verifyOperatorApproval(bad.envelope, publicPem, bad.expected, now),
		).toThrow();
	});
});
it("bounds production contexts and never reuses request namespaces or unqualified team references", () => {
	const input = {
		organizationId: randomUUID(),
		epoch: randomUUID(),
		actorId: randomUUID(),
		role: "member" as const,
		teamId: randomUUID(),
		teamMember: true,
	};
	const first = compileContext(input),
		second = compileContext(input);
	expect(first.object).not.toBe(second.object);
	expect(first.tuples.length).toBeLessThanOrEqual(4);
	const prefix = first.object.slice(5, first.object.lastIndexOf("/"));
	expect(first.tuples.every((tuple) => tuple.object.includes(prefix))).toBe(
		true,
	);
	expect(
		first.tuples.find((tuple) => tuple.relation === "organization")?.user,
	).toBe(`organization:${prefix}/root`);
	expect(() =>
		compileContext({ ...input, actorId: "user:injected#member" }),
	).toThrow();
	expect(() =>
		compileContext({ ...input, organizationId: "tenant/other" }),
	).toThrow();
});
