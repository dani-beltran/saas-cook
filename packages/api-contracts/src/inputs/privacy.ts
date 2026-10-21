import { z } from "zod";
import { operationKey, publicId } from "./common";

export const deletionRequestInput = z
	.strictObject({
		kind: z.enum(["account", "organization"]),
		organizationId: publicId.optional(),
		operationKey: operationKey.regex(/^[a-zA-Z0-9_-]+$/),
	})
	.refine((i) => i.kind !== "organization" || Boolean(i.organizationId), {
		path: ["organizationId"],
	});
/** Receipt syntax only; the service must still verify the stored receipt hash. */
export const deletionStatusInput = z.strictObject({
	id: publicId,
	receipt: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type DeletionRequestInput = z.infer<typeof deletionRequestInput>;
