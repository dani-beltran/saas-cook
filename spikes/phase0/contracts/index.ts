import { oc } from "@orpc/contract";
import { z } from "zod";

export const projectDto = z.object({
	id: z.string(),
	organizationId: z.string(),
	name: z.string(),
	version: z.number().int(),
});
const identity = {
	organizationId: z.enum(["alpha", "beta"]),
	id: z.string().min(1),
};
const errorData = z.object({ requestId: z.uuid() });
const base = oc.errors({
	UNAUTHORIZED: { status: 401, data: errorData },
	FORBIDDEN: { status: 403, data: errorData },
	NOT_FOUND: { status: 404, data: errorData },
	CONFLICT: { status: 409, data: errorData },
	UNPROCESSABLE_CONTENT: {
		status: 422,
		data: errorData.extend({
			issues: z.array(
				z.object({
					path: z.array(z.union([z.string(), z.number()])),
					message: z.string(),
				}),
			),
		}),
	},
});
export const contract = {
	read: base
		.route({
			method: "GET",
			path: "/organizations/{organizationId}/projects/{id}",
		})
		.input(z.strictObject(identity))
		.output(projectDto),
	update: base
		.route({
			method: "PATCH",
			path: "/organizations/{organizationId}/projects/{id}",
		})
		.input(
			z.strictObject({
				...identity,
				name: z.string().min(1).max(100),
				version: z.number().int().positive(),
				idempotencyKey: z.string().min(1).max(80),
			}),
		)
		.output(projectDto),
};
