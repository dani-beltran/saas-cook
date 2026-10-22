import { describe, expect, it } from "vitest";
import {
	assertCompatiblePair,
	compatibilityManifest,
} from "./compatibility-contract";

describe("initial release compatibility", () => {
	it("supports only the declared exact current customer and operator contracts", async () => {
		const customer = await compatibilityManifest("customer");
		const backoffice = await compatibilityManifest("backoffice");
		await expect(
			assertCompatiblePair(customer, backoffice),
		).resolves.toBeUndefined();
		for (const change of [
			{ version: 2 },
			{ target: "customer" },
			{ operatorModel: "0".repeat(64) },
			{ sharedServiceSha256: "0".repeat(64) },
			{ tenantModel: "0".repeat(64) },
			{ controlContractSha256: "0".repeat(64) },
			{
				applicationSchema: {
					...backoffice.applicationSchema,
					max: backoffice.applicationSchema.max + 1,
				},
			},
			{ protocols: { ...backoffice.protocols, deletionJournal: 2 } },
			{ unknown: "future" },
		])
			await expect(
				assertCompatiblePair(customer, { ...backoffice, ...change }),
			).rejects.toThrow();
		await expect(assertCompatiblePair(backoffice, customer)).rejects.toThrow();
	});
	it("rejects matching unknown contracts on both sides of the pair", async () => {
		const customer = await compatibilityManifest("customer");
		const backoffice = await compatibilityManifest("backoffice");
		for (const change of [
			{
				applicationSchema: {
					...customer.applicationSchema,
					min: 999,
					max: 999,
				},
			},
			{ tenantModel: "0".repeat(64) },
			{ controlContractSha256: "0".repeat(64) },
			{ sharedServiceSha256: "0".repeat(64) },
			{ protocols: { ...customer.protocols, stripeApi: "unknown" } },
		])
			await expect(
				assertCompatiblePair(
					{ ...customer, ...change },
					{ ...backoffice, ...change },
				),
			).rejects.toThrow("Unsupported image contract");
	});
});
