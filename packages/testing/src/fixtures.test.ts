import { expect, it } from "vitest";
import { organizations, syntheticUser } from "./index";

it("provides distinct organizations and one synthetic user with both memberships", () => {
	expect(new Set(organizations.map(({ id }) => id)).size).toBe(2);
	expect(
		syntheticUser.memberships.map(({ organizationId }) => organizationId),
	).toEqual(organizations.map(({ id }) => id));
	expect(syntheticUser.email).toMatch(/@example\.test$/);
});
