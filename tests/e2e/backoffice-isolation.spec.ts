import { expect, test } from "@playwright/test";

test("customer application does not serve Backoffice metadata endpoints", async ({
	request,
}) => {
	const response = await request.post("/api/organizations/lookup", {
		data: {
			organizationId: "00000000-0000-4000-8000-000000000001",
			caseReference: "ISOLATION",
		},
	});
	expect(response.status()).toBe(404);
});
