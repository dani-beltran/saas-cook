import { z } from "zod";
import { platformOperation as op } from "./platform";

const id = { id: z.uuid() };
const key = { operationKey: z.string().min(8).max(120) };
const deletion = z.strictObject({
	id: z.uuid(),
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
						organizationId: z.uuid(),
						membershipId: z.uuid(),
						name: z.string(),
						role: z.string(),
						requiresSuccessor: z.boolean(),
					}),
				)
				.max(1000),
		),
	requestDeletion: op
		.route({ method: "POST", path: "/platform/deletionRequest" })
		.input(
			z.strictObject({
				kind: z.enum(["account", "organization"]),
				organizationId: z.uuid().optional(),
				...key,
			}),
		)
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
		.input(z.strictObject({ ...id, receipt: z.string().min(43).max(43) }))
		.output(deletion),
};
