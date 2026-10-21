import { z } from "zod";
import { platformOperation as op } from "./platform";

const org = { organizationId: z.uuid() };
const id = { id: z.uuid() };
const key = { operationKey: z.string().min(8).max(120) };
const mapping = z.strictObject({
	name: z.string().min(1).max(100),
	slug: z.string().min(1).max(100),
	description: z.string().min(1).max(100).optional(),
});
const bulkInput = {
	kind: z.enum([
		"projects.import",
		"projects.export",
		"organization.export",
		"audit.export",
	]),
	...key,
	projectId: z.uuid().optional(),
	fileId: z.uuid().optional(),
	mapping: mapping.optional(),
	duplicates: z.enum(["reject", "skip"]).optional(),
};
const job = z.strictObject({
	id: z.uuid(),
	kind: bulkInput.kind,
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
		.input(z.strictObject({ ...org, ...bulkInput }))
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
		.input(z.strictObject({ ...org, ...bulkInput }))
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
