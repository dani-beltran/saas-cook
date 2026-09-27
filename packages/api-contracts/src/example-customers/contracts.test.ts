import { describe, expect, it } from "vitest";
import {
	customerCreate,
	customerDto,
	customerQuery,
	customerUpdate,
} from "./index";

describe("strict example-customers allowlists", () => {
	const valid = {
		name: "Ada",
		email: "ada@example.test",
		operationKey: "operation-123",
	};
	it("rejects hidden fields and invalid field/query values", () => {
		for (const key of [
			"id",
			"organizationId",
			"version",
			"createdAt",
			"deletedAt",
			"userId",
		])
			expect(
				customerCreate.safeParse({ ...valid, [key]: "forged" }).success,
			).toBe(false);
		for (const fields of [
			{ name: " " },
			{ name: "x".repeat(121) },
			{ email: "bad" },
			{ company: "x".repeat(121) },
			{ status: "archived" },
		])
			expect(customerCreate.safeParse({ ...valid, ...fields }).success).toBe(
				false,
			);
		expect(customerCreate.parse(valid)).toMatchObject({
			company: "",
			status: "lead",
		});
		for (const q of [
			{ limit: 11 },
			{ limit: 0 },
			{ sort: "email" },
			{ direction: "sideways" },
			{ includeDeleted: true },
			{ search: "x".repeat(121) },
		])
			expect(customerQuery.safeParse(q).success).toBe(false);
		expect(customerQuery.parse({ limit: "10" }).limit).toBe(10);
		expect(customerUpdate.safeParse(valid).success).toBe(false);
		expect(customerDto.safeParse({ ...valid, id: "forged" }).success).toBe(
			false,
		);
	});
});
