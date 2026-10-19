import { expect, it } from "vitest";
import {
	billingCommand,
	billingSelection,
} from "../../api-contracts/src/billing";
import { handleApi } from "./handlers";

it("rejects caller provider/customer/amount fields and unsupported quantities", () => {
	expect(
		billingSelection.safeParse({ planVersionId: "team/v1", quantity: 0 })
			.success,
	).toBe(false);
	expect(
		billingSelection.safeParse({
			planVersionId: "team/v1",
			quantity: 3,
			priceId: "price_forged",
		}).success,
	).toBe(false);
	expect(
		billingCommand.safeParse({
			kind: "checkout",
			operationKey: "one",
			selection: { planVersionId: "team/v1", quantity: 3 },
			locale: "en",
			customerId: "cus_forged",
		}).success,
	).toBe(false);
});
for (const transport of ["rpc", "rest"] as const)
	it(`${transport} billing rejects bearer principals before cookie fallback`, async () => {
		const organizationId = "10000000-0000-4000-8000-000000000001";
		for (const authorization of ["Bearer cs_synthetic", "", "Invalid"]) {
			const response = await handleApi(
				new Request(
					`http://localhost${transport === "rpc" ? "/api/rpc/billing/get" : `/api/v1/organizations/${organizationId}/billing`}`,
					{
						method: transport === "rpc" ? "POST" : "GET",
						headers: {
							authorization,
							cookie: "verified=synthetic",
							"content-type": "application/json",
						},
						...(transport === "rpc"
							? { body: JSON.stringify({ json: { organizationId } }) }
							: {}),
					},
				),
				transport,
			);
			expect(response.status).toBe(403);
		}
	});
