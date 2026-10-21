import { oc } from "@orpc/contract";
import { z } from "zod";
import { operationKey, publicId, resourceSlug } from "./inputs/common";
import {
	projectDescription,
	projectStatus,
	resourceName,
} from "./inputs/resources";

const organizationId = publicId;
const name = resourceName;
const slug = resourceSlug;
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const cursor = z.string().min(1).max(2048).optional();
const limit = z.coerce.number<number>().int().min(1).max(50).optional();
const status = projectStatus;
const errorData = z.object({ requestId: publicId });
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
	id: publicId,
	organizationId,
	name: z.string(),
	slug: z.string(),
	description: z.string(),
	status,
	ownerMembershipId: publicId.nullable(),
	version,
	createdAt: z.string(),
	updatedAt: z.string(),
	deletedAt: z.string().nullable(),
});
const projectReference = { organizationId, id: publicId };
const projectVersion = { ...projectReference, version };
const projectPath = "/organizations/{organizationId}/projects";
const grantSubject = z.strictObject({
	kind: z.enum(["membership", "team"]),
	id: publicId,
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
					description: projectDescription.optional(),
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
					description: projectDescription.optional(),
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
					resourceId: publicId,
					subject: grantSubject,
					relation: z.enum(["viewer", "editor", "manager", "denied"]),
					expiresAt: z.iso.datetime().optional(),
					operationKey,
				}),
			)
			.output(z.object({ id: publicId })),
		revoke: protectedOperation
			.route({
				method: "DELETE",
				path: "/organizations/{organizationId}/resource-grants/{grantId}",
				summary: "Revoke an existing resource grant synchronously",
			})
			.input(z.strictObject({ organizationId, grantId: publicId }))
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
	id: publicId,
	name: z.string(),
	status: z.enum(["active", "inactive"]),
	capabilities: z.array(z.string()),
	version,
});
const issuedKeyDto = z.object({
	id: publicId,
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
				id: publicId,
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
				serviceAccountId: publicId,
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
				keyId: publicId,
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
		.input(z.strictObject({ organizationId, keyId: publicId }))
		.output(z.object({ ok: z.literal(true) })),
};
export type ProjectDto = z.infer<typeof projectDto>;
