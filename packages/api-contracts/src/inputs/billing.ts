import { z } from "zod";
import { publicId } from "./common";

// Billing's established key bounds differ from the Foundation command key.
const billingOperationKey = z.string().min(1).max(128);
export const billingSelection = z.strictObject({
	planVersionId: z.string().min(1).max(60),
	quantity: z.number().int().min(1).max(100000),
});
export const billingCommand = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("checkout"),
		operationKey: billingOperationKey,
		selection: billingSelection,
		locale: z.enum(["en", "es"]),
	}),
	z.strictObject({
		kind: z.literal("change"),
		operationKey: billingOperationKey,
		previewId: publicId,
	}),
	z.strictObject({
		kind: z.enum(["cancel", "portal"]),
		operationKey: billingOperationKey,
	}),
]);
