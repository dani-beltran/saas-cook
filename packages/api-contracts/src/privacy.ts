import { z } from "zod";
import { publicId } from "./inputs/common";
import { deletionRequestInput, deletionStatusInput } from "./inputs/privacy";
import { platformOperation as op } from "./platform";

const id = { id: publicId };
const deletion = z.strictObject({
	id: publicId,
	subjectKind: z.enum(["account", "organization"]),
	state: z.enum([
		"awaiting_prerequisites",
		"journal_pending",
		"scheduled",
		"purging",
		"complete",
		"canceled",
	]),
	retained: z.array(z.string()).max(20),
	steps: z.array(z.string()).max(10),
	effectiveAt: z.iso.datetime().nullable(),
	completedAt: z.iso.datetime().nullable(),
	backupExpiry: z.literal("not-confirmed"),
});
export const privacyContract = {
	exportAccount: op
		.route({ method: "POST", path: "/platform/personalExport" })
		.input(z.strictObject({}))
		.output(
			z.strictObject({
				filename: z.string(),
				contentType: z.string(),
				base64: z.string().max(1400000),
			}),
		),
	previewDeletion: op
		.route({ method: "POST", path: "/platform/deletionPreview" })
		.input(z.strictObject({}))
		.output(
			z
				.array(
					z.strictObject({
						organizationId: publicId,
						membershipId: publicId,
						name: z.string(),
						role: z.string(),
						requiresSuccessor: z.boolean(),
					}),
				)
				.max(1000),
		),
	requestDeletion: op
		.route({ method: "POST", path: "/platform/deletionRequest" })
		.input(deletionRequestInput)
		.output(deletion.extend({ receipt: z.string() })),
	confirmDeletion: op
		.route({ method: "POST", path: "/platform/deletionConfirm" })
		.input(z.strictObject({ ...id }))
		.output(deletion),
	cancelDeletion: op
		.route({ method: "POST", path: "/platform/deletionCancel" })
		.input(z.strictObject({ ...id }))
		.output(deletion),
	deletionStatus: op
		.route({ method: "POST", path: "/platform/deletionStatus" })
		.input(deletionStatusInput)
		.output(deletion),
};
