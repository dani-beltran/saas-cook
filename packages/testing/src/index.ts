/** Synthetic identities for deterministic tests only. Never an authentication source. */
export const organizations = [
	{
		id: "00000000-0000-4000-8000-000000000001",
		slug: "alpha",
		name: "Alpha test organization",
	},
	{
		id: "00000000-0000-4000-8000-000000000002",
		slug: "beta",
		name: "Beta test organization",
	},
] as const;
export const syntheticUser = {
	id: "00000000-0000-4000-8000-000000000010",
	email: "member@example.test",
	memberships: organizations.map(({ id }) => ({
		organizationId: id,
		role: "owner" as const,
	})),
};
