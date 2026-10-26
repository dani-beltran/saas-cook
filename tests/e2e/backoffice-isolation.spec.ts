import { expect, test } from "@playwright/test";

test("customer application does not serve Backoffice metadata endpoints", async ({
	request,
}) => {
	for (const endpoint of ["lookup", "directory"]) {
		const response = await request.post(`/api/organizations/${endpoint}`, {
			data: {
				organizationId: "00000000-0000-4000-8000-000000000001",
				caseReference: "ISOLATION",
				...(endpoint === "directory" ? { pageSize: 10 } : {}),
			},
		});
		expect(response.status()).toBe(404);
	}
});
