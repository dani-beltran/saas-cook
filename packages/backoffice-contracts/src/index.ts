import { z } from "zod";

/** Exact-ID metadata input; case references are identifiers, never arbitrary support text. */
export const organizationLookupInput = z.strictObject({
	organizationId: z.uuid(),
	caseReference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
});
/** Explicit disclosure allowlist; null capacity means no configured local ceiling. */
export const organizationLookupOutput = z.strictObject({
	id: z.uuid(),
	name: z.string(),
	lifecycle: z.string(),
	seats: z.strictObject({
		occupied: z.number().int().nonnegative(),
		capacity: z.number().int().nonnegative().nullable(),
	}),
	sourceTimestamp: z.iso.datetime(),
	auditReference: z.uuid(),
});

/** Browser/server lookup input derived from the shared schema. */
export type OrganizationLookupInput = z.infer<typeof organizationLookupInput>;

/** Allowlisted live organization states; unknown states cannot be disclosed by the directory. */
export const organizationLifecycle = z.enum([
	"active",
	"owner_recovery_required",
	"suspended",
]);
/** Bounded directory filters. Personal names/emails and arbitrary sort expressions are not accepted. */
export const organizationDirectoryInput = z.strictObject({
	caseReference: organizationLookupInput.shape.caseReference,
	organizationId: z.uuid().toLowerCase().optional(),
	lifecycle: organizationLifecycle.optional(),
	pageSize: z.number().int().min(1).max(50),
	cursor: z.string().min(1).max(2048).optional(),
});
/** Masked list projection, with a live-read timestamp rather than a projection freshness claim. */
export const organizationDirectoryOutput = z.strictObject({
	items: z
		.array(
			z.strictObject({
				id: z.uuid(),
				maskedName: z.string(),
				lifecycle: organizationLifecycle,
				sourceTimestamp: z.iso.datetime(),
			}),
		)
		.max(50),
	nextCursor: z.string().nullable(),
	freshness: z.strictObject({
		kind: z.literal("live"),
		checkedAt: z.iso.datetime(),
	}),
	auditReference: z.uuid(),
});
/** Validated directory request shared by browser and service boundaries. */
export type OrganizationDirectoryInput = z.infer<
	typeof organizationDirectoryInput
>;
/** Explicit directory response; no account, owner, billing or unrestricted totals. */
export type OrganizationDirectoryOutput = z.infer<
	typeof organizationDirectoryOutput
>;
