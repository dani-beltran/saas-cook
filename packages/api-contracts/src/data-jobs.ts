import { z } from "zod";
import { publicId } from "./inputs/common";
import { bulkInput, bulkKind } from "./inputs/data-jobs";
import { platformOperation as op } from "./platform";

const org = { organizationId: publicId };
const id = { id: publicId };
const job = z.strictObject({
	id: publicId,
	kind: bulkKind,
	state: z.string(),
	progress: z.number().int(),
	total: z.number().int(),
	errors: z
		.array(z.strictObject({ row: z.number().int(), code: z.string() }))
		.max(1000),
	expiresAt: z.iso.datetime(),
});
export const dataJobsContract = {
	list: op
		.route({ method: "GET", path: "/platform/bulkList" })
		.input(z.strictObject({ ...org }))
		.output(z.array(job).max(20)),
	dryRun: op
		.route({ method: "POST", path: "/platform/bulkDryRun" })
		.input(bulkInput.safeExtend(org))
		.output(
			z
				.array(
					z.strictObject({
						row: z.number().int(),
						errors: z.array(z.string()),
					}),
				)
				.max(1000),
		),
	start: op
		.route({ method: "POST", path: "/platform/bulkStart" })
		.input(bulkInput.safeExtend(org))
		.output(job),
	cancel: op
		.route({ method: "POST", path: "/platform/bulkCancel" })
		.input(z.strictObject({ ...org, ...id }))
		.output(z.object({ canceled: z.boolean() })),
	resume: op
		.route({ method: "POST", path: "/platform/bulkResume" })
		.input(z.strictObject({ ...org, ...id }))
		.output(z.object({ resumed: z.boolean() })),
	download: op
		.route({ method: "POST", path: "/platform/bulkDownload" })
		.input(z.strictObject({ ...org, ...id }))
		.output(
			z.strictObject({
				filename: z.string(),
				contentType: z.string(),
				base64: z.string().max(1400000),
			}),
		),
};
