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
