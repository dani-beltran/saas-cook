import { z } from "zod";
import { operationKey, publicId } from "./common";

export const bulkKind = z.enum([
	"projects.import",
	"projects.export",
	"organization.export",
	"audit.export",
]);
export const bulkMapping = z.strictObject({
	name: z.string().min(1).max(100),
	slug: z.string().min(1).max(100),
	description: z.string().min(1).max(100).optional(),
});
/** Import references are required together; exports cannot carry import fields. */
export const bulkInput = z
	.strictObject({
		kind: bulkKind,
		operationKey,
		projectId: publicId.optional(),
		fileId: publicId.optional(),
		mapping: bulkMapping.optional(),
		duplicates: z.enum(["reject", "skip"]).optional(),
	})
	.refine((i) =>
		i.kind === "projects.import"
			? Boolean(i.projectId && i.fileId && i.mapping && i.duplicates)
			: !i.projectId && !i.fileId && !i.mapping && !i.duplicates,
	);
export type BulkInput = z.infer<typeof bulkInput>;
export type BulkMapping = z.infer<typeof bulkMapping>;
