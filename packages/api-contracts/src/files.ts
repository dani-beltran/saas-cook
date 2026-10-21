import { oc } from "@orpc/contract";
import { z } from "zod";
import { operationKey, publicId } from "./inputs/common";

const reference = { organizationId: publicId, projectId: publicId };
export const uploadInput = z.strictObject({
	projectId: publicId,
	operationKey: operationKey,
	name: z
		.string()
		.trim()
		.min(1)
		.max(120)
		.regex(/\.(txt|csv)$/i)
		.refine(
			(v) => !/[\\/]/.test(v) && [...v].every((c) => c.charCodeAt(0) >= 32),
		),
	contentType: z.enum(["text/plain", "text/csv"]),
	bytes: z.number().int().min(1).max(1048576),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
/** Metadata checked before the browser reads and hashes an upload. */
export const fileMetadata = uploadInput.pick({
	name: true,
	contentType: true,
	bytes: true,
});
export const fileDto = z.strictObject({
	id: publicId,
	projectId: publicId,
	name: z.string(),
	contentType: z.enum(["text/plain", "text/csv"]),
	bytes: z.number().int(),
	state: z.enum(["staging", "available", "rejected", "deleted"]),
	expiresAt: z.iso.datetime(),
});
const data = z.object({ requestId: publicId });
const operation = oc.errors({
	UNAUTHORIZED: { status: 401, data },
	FORBIDDEN: { status: 403, data },
	NOT_FOUND: { status: 404, data },
	CONFLICT: { status: 409, data },
	PRECONDITION_FAILED: { status: 412, data },
	UNPROCESSABLE_CONTENT: {
		status: 422,
		data: data.extend({
			issues: z.array(
				z.object({
					path: z.array(z.union([z.string(), z.number()])),
					message: z.string(),
				}),
			),
		}),
	},
	SERVICE_UNAVAILABLE: { status: 503, data },
});
const path = "/organizations/{organizationId}/projects/{projectId}/files";
export const filesContract = {
	list: operation
		.route({ method: "GET", path })
		.input(z.strictObject({ ...reference }))
		.output(z.array(fileDto).max(100)),
	initiate: operation
		.route({ method: "POST", path })
		.input(uploadInput.extend({ organizationId: publicId }))
		.output(
			z.strictObject({
				file: fileDto,
				url: z.url(),
				headers: z.strictObject({
					"content-type": z.enum(["text/plain", "text/csv"]),
					"if-none-match": z.literal("*"),
					"x-amz-checksum-sha256": z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
				}),
			}),
		),
	finalize: operation
		.route({ method: "POST", path: `${path}/{id}/finalize` })
		.input(z.strictObject({ ...reference, id: publicId }))
		.output(fileDto),
	download: operation
		.route({ method: "GET", path: `${path}/{id}/download` })
		.input(z.strictObject({ ...reference, id: publicId }))
		.output(z.strictObject({ file: fileDto, base64: z.string().max(1398104) })),
};
