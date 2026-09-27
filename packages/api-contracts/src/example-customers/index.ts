import { oc } from "@orpc/contract";
import { z } from "zod";

export const customerStatus = z.enum(["lead", "active", "inactive"]);
const version = z.number().int().min(1).max(2147483647);
const operationKey = z.string().min(8).max(120);
export const customerFields = z.strictObject({
	name: z.string().trim().min(1).max(120),
	email: z.string().trim().max(254).pipe(z.email()),
	company: z.string().trim().max(120).prefault(""),
	status: customerStatus.prefault("lead"),
});
export const customerCreate = customerFields.extend({ operationKey });
export const customerReference = z.strictObject({ id: z.uuid() });
export const customerDelete = customerReference.extend({
	version,
	operationKey,
});
export const customerUpdate = customerFields.extend({
	id: z.uuid(),
	version,
	operationKey,
});
export const customerQuery = z.strictObject({
	search: z.string().trim().max(120).prefault(""),
	status: customerStatus.optional(),
	sort: z.enum(["name", "company", "createdAt"]).prefault("createdAt"),
	direction: z.enum(["asc", "desc"]).prefault("desc"),
	limit: z.coerce
		.number()
		.pipe(z.union([z.literal(10), z.literal(25), z.literal(50)]))
		.prefault(25),
	cursor: z.string().min(1).max(2048).optional(),
});
export const customerDto = z.strictObject({
	id: z.uuid(),
	organizationId: z.uuid(),
	name: z.string().min(1).max(120),
	email: z.email().max(254),
	company: z.string().max(120).nullable(),
	status: customerStatus,
	version,
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
	deletedAt: z.iso.datetime().nullable(),
});
export const customerPage = z.strictObject({
	items: z.array(customerDto).max(50),
	nextCursor: z.string().nullable(),
});
const errors = z.object({ requestId: z.uuid() });
const protectedOperation = oc.errors({
	UNAUTHORIZED: { status: 401, data: errors },
	FORBIDDEN: { status: 403, data: errors },
	NOT_FOUND: { status: 404, data: errors },
	CONFLICT: { status: 409, data: errors },
	UNPROCESSABLE_CONTENT: {
		status: 422,
		data: errors.extend({
			issues: z.array(
				z.object({
					path: z.array(z.union([z.string(), z.number()])),
					message: z.string(),
				}),
			),
		}),
	},
	SERVICE_UNAVAILABLE: { status: 503, data: errors },
});
const context = { organizationId: z.uuid() };
const path = "/organizations/{organizationId}/example-customers";
export const exampleCustomersContract = {
	list: protectedOperation
		.route({
			method: "GET",
			path,
			summary:
				"List example business contacts with organization read permission",
		})
		.input(customerQuery.extend(context))
		.output(customerPage),
	get: protectedOperation
		.route({ method: "GET", path: `${path}/{id}` })
		.input(customerReference.extend(context))
		.output(customerDto),
	create: protectedOperation
		.route({ method: "POST", path })
		.input(customerCreate.extend(context))
		.output(customerDto),
	update: protectedOperation
		.route({ method: "PATCH", path: `${path}/{id}` })
		.input(customerUpdate.extend(context))
		.output(customerDto),
	delete: protectedOperation
		.route({
			method: "DELETE",
			path: `${path}/{id}`,
			summary: "Soft-delete a business contact; retained data is not erased",
		})
		.input(customerDelete.extend(context))
		.output(customerDto),
};
export type CustomerDto = z.infer<typeof customerDto>;
export type CustomerQuery = z.infer<typeof customerQuery>;

export type CustomerCreateInput = z.input<typeof customerCreate>;
export type CustomerUpdateInput = z.input<typeof customerUpdate>;
export type CustomerDeleteInput = z.input<typeof customerDelete>;
