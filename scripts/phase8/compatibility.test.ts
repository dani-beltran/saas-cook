import { describe, expect, it } from "vitest";
import {
	assertCompatiblePair,
	compatibilityManifest,
} from "./compatibility-contract";

describe("initial release compatibility", () => {
	it("supports only the declared exact current customer and operator contracts", async () => {
		const customer = await compatibilityManifest("customer");
		const backoffice = await compatibilityManifest("backoffice");
		expect(() => assertCompatiblePair(customer, backoffice)).not.toThrow();
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
			expect(() =>
				assertCompatiblePair(customer, { ...backoffice, ...change }),
			).toThrow();
		expect(() => assertCompatiblePair(backoffice, customer)).toThrow();
	});
});
