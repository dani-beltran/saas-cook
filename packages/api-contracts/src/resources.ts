import { oc } from "@orpc/contract";
import { z } from "zod";

const organizationId = z.uuid();
const operationKey = z.string().min(8).max(120);
const name = z.string().trim().min(2).max(80);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const cursor = z.string().min(1).max(2048).optional();
const limit = z.coerce.number<number>().int().min(1).max(50).optional();
const status = z.enum(["active", "completed", "archived"]);
const errorData = z.object({ requestId: z.uuid() });
const protectedOperation = oc.errors({
	UNAUTHORIZED: { status: 401, data: errorData },
	FORBIDDEN: { status: 403, data: errorData },
	NOT_FOUND: { status: 404, data: errorData },
	CONFLICT: { status: 409, data: errorData },
	PRECONDITION_FAILED: { status: 412, data: errorData },
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
	SERVICE_UNAVAILABLE: { status: 503, data: errorData },
});
// These allowlists deliberately exclude internal policy state, keys and storage rows.
const projectDto = z.object({
	id: z.uuid(),
	organizationId,
	name: z.string(),
	slug: z.string(),
	description: z.string(),
	status,
	ownerMembershipId: z.uuid().nullable(),
	version,
	createdAt: z.string(),
	updatedAt: z.string(),
	deletedAt: z.string().nullable(),
});
const projectReference = { organizationId, id: z.uuid() };
const projectVersion = { ...projectReference, version };
const projectPath = "/organizations/{organizationId}/projects";
const grantSubject = z.strictObject({
	kind: z.enum(["membership", "team"]),
	id: z.uuid(),
});
export const resourcesContract = {
	projects: {
		list: protectedOperation
			.route({
				method: "GET",
				path: projectPath,
				summary: "Search currently authorized Projects in bounded cursor order",
			})
			.input(
				z.strictObject({
					organizationId,
					limit,
					cursor,
					search: z.string().trim().max(120).optional(),
					status: status.optional(),
					includeDeleted: z
						.union([z.boolean(), z.enum(["true", "false"])])
						.transform((value) => value === true || value === "true")
						.pipe(z.boolean())
						.optional(),
				}),
			)
			.output(
				z.object({
					items: z.array(projectDto),
					nextCursor: z.string().nullable(),
				}),
			),
		get: protectedOperation
			.route({
				method: "GET",
				path: `${projectPath}/{id}`,
				summary: "Read a currently authorized Project",
			})
			.input(z.strictObject(projectReference))
			.output(projectDto),
		create: protectedOperation
			.route({
				method: "POST",
				path: projectPath,
				summary:
					"Create a Project with authorization, capacity and scoped idempotency",
			})
			.input(
				z.strictObject({
					organizationId,
					name,
					slug,
					description: z.string().max(4000).optional(),
					operationKey,
				}),
			)
			.output(projectDto),
		update: protectedOperation
			.route({
				method: "PATCH",
				path: `${projectPath}/{id}`,
				summary: "Edit allowlisted Project fields at an expected version",
			})
			.input(
				z.strictObject({
					...projectVersion,
					name: name.optional(),
					description: z.string().max(4000).optional(),
					status: status.optional(),
				}),
			)
			.output(projectDto),
		delete: protectedOperation
			.route({
				method: "DELETE",
				path: `${projectPath}/{id}`,
				summary: "Soft-delete a Project at an expected version",
			})
			.input(z.strictObject({ ...projectVersion, operationKey }))
			.output(projectDto),
		restore: protectedOperation
			.route({
				method: "POST",
				path: `${projectPath}/{id}/restore`,
				summary:
					"Restore a Project subject to current authorization and capacity",
			})
			.input(z.strictObject({ ...projectVersion, operationKey }))
			.output(projectDto),
	},
	grants: {
		create: protectedOperation
			.route({
				method: "POST",
				path: "/organizations/{organizationId}/resource-grants",
				summary: "Share a registered resource with a current member or team",
			})
			.input(
				z.strictObject({
					organizationId,
					resourceId: z.uuid(),
					subject: grantSubject,
					relation: z.enum(["viewer", "editor", "manager", "denied"]),
					expiresAt: z.iso.datetime().optional(),
					operationKey,
				}),
			)
			.output(z.object({ id: z.uuid() })),
		revoke: protectedOperation
			.route({
				method: "DELETE",
				path: "/organizations/{organizationId}/resource-grants/{grantId}",
				summary: "Revoke an existing resource grant synchronously",
			})
			.input(z.strictObject({ organizationId, grantId: z.uuid() }))
			.output(z.object({ ok: z.literal(true) })),
	},
};
const scope = z.enum([
	"project:read",
	"project:create",
	"project:update",
	"project:delete",
	"project:restore",
	"project:manage",
]);
const scopes = z.array(scope).min(1).max(6);
const accountDto = z.object({
	id: z.uuid(),
	name: z.string(),
	status: z.enum(["active", "inactive"]),
	capabilities: z.array(z.string()),
	version,
});
const issuedKeyDto = z.object({
	id: z.uuid(),
	secret: z.string(),
	prefix: z.string(),
	expiresAt: z.string(),
});
const keyPath = "/organizations/{organizationId}/api-keys";
export const serviceAccountContract = {
	create: protectedOperation
		.route({
			method: "POST",
			path: "/organizations/{organizationId}/service-accounts",
			summary: "Provision a service account (fresh human session required)",
		})
		.input(
			z.strictObject({
				organizationId,
				name,
				operationKey,
				capabilities: z
					.array(z.enum(["project:read", "project:create"]))
					.max(2),
			}),
		)
		.output(accountDto),
	setStatus: protectedOperation
		.route({
			method: "PATCH",
			path: "/organizations/{organizationId}/service-accounts/{id}",
			summary: "Activate or deactivate a service account",
		})
		.input(
			z.strictObject({
				organizationId,
				id: z.uuid(),
				status: z.enum(["active", "inactive"]),
				version,
			}),
		)
		.output(accountDto),
	issue: protectedOperation
		.route({
			method: "POST",
			path: keyPath,
			summary: "Issue an expiring scoped API key; secret is returned once",
		})
		.input(
			z.strictObject({
				organizationId,
				serviceAccountId: z.uuid(),
				operationKey,
				scopes,
				expiresAt: z.iso.datetime(),
			}),
		)
		.output(issuedKeyDto),
	rotate: protectedOperation
		.route({
			method: "POST",
			path: `${keyPath}/{keyId}/rotate`,
			summary: "Revoke a key and issue its replacement atomically",
		})
		.input(
			z.strictObject({
				organizationId,
				keyId: z.uuid(),
				operationKey,
				expiresAt: z.iso.datetime(),
			}),
		)
		.output(issuedKeyDto),
	revoke: protectedOperation
		.route({
			method: "DELETE",
			path: `${keyPath}/{keyId}`,
			summary: "Revoke an API key",
		})
		.input(z.strictObject({ organizationId, keyId: z.uuid() }))
		.output(z.object({ ok: z.literal(true) })),
};
export type ProjectDto = z.infer<typeof projectDto>;
