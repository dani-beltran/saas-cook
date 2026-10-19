import { oc } from "@orpc/contract";
import { z } from "zod";

export const platformResourceType = z.enum(["project", "customer"]);
const pagination = {
	limit: z.coerce.number().int().min(1).max(50).prefault(25),
	cursor: z.string().min(1).max(2048).optional(),
};
export const searchQuery = z.strictObject({
	query: z.string().trim().min(1).max(120),
	type: platformResourceType.optional(),
	...pagination,
});
export const searchItem = z.strictObject({
	id: z.uuid(),
	type: platformResourceType,
	label: z.string().max(120),
});
export const activityQuery = z.strictObject({
	resourceType: platformResourceType,
	resourceId: z.uuid(),
	...pagination,
});
export const activityItem = z.strictObject({
	id: z.uuid(),
	action: z.enum(["created", "updated", "deleted", "restored"]),
	actor: z.enum(["member", "service", "system"]),
	occurredAt: z.iso.datetime(),
	schemaVersion: z.literal(1),
});
const errors = z.object({ requestId: z.uuid() });
export const platformOperation = oc.errors({
	UNAUTHORIZED: { status: 401, data: errors },
	FORBIDDEN: { status: 403, data: errors },
	NOT_FOUND: { status: 404, data: errors },
	CONFLICT: { status: 409, data: errors },
	PRECONDITION_FAILED: { status: 412, data: errors },
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
export const keyListQuery = z.strictObject({
	serviceAccountId: z.uuid().optional(),
	...pagination,
});
export const accountSummary = z.strictObject({
	id: z.uuid(),
	name: z.string().max(120),
	status: z.enum(["active", "inactive"]),
	capabilities: z.array(z.string()),
	version: z.number().int().positive(),
});
export const keySummary = z.strictObject({
	id: z.uuid(),
	prefix: z.string(),
	scopes: z.array(z.string()),
	expiresAt: z.iso.datetime(),
	revokedAt: z.iso.datetime().nullable(),
	lastUsedAt: z.iso.datetime().nullable(),
});
export const platformContract = {
	accounts: platformOperation
		.route({
			method: "GET",
			path: "/organizations/{organizationId}/service-accounts",
		})
		.input(z.strictObject({ organizationId: z.uuid(), ...pagination }))
		.output(
			z.strictObject({
				items: z.array(accountSummary).max(50),
				nextCursor: z.string().nullable(),
			}),
		),
	keys: platformOperation
		.route({
			method: "GET",
			path: "/organizations/{organizationId}/service-accounts/{serviceAccountId}/keys",
		})
		.input(
			keyListQuery.extend({
				organizationId: z.uuid(),
				serviceAccountId: z.uuid(),
			}),
		)
		.output(
			z.strictObject({
				items: z.array(keySummary).max(50),
				nextCursor: z.string().nullable(),
			}),
		),
	search: platformOperation
		.route({
			method: "GET",
			path: "/organizations/{organizationId}/search",
			summary:
				"Search registered resources with current access; no unrestricted totals",
		})
		.input(searchQuery.extend({ organizationId: z.uuid() }))
		.output(
			z.strictObject({
				items: z.array(searchItem).max(50),
				nextCursor: z.string().nullable(),
			}),
		),
	activity: platformOperation
		.route({
			method: "GET",
			path: "/organizations/{organizationId}/activity/{resourceType}/{resourceId}",
			summary:
				"Read the safe activity projection under current resource access",
		})
		.input(activityQuery.extend({ organizationId: z.uuid() }))
		.output(
			z.strictObject({
				items: z.array(activityItem).max(50),
				nextCursor: z.string().nullable(),
			}),
		),
};
export type SearchQuery = z.input<typeof searchQuery>;
export type ActivityQuery = z.input<typeof activityQuery>;
export type SearchItem = z.infer<typeof searchItem>;
