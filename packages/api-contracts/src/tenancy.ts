import { oc } from "@orpc/contract";
import { z } from "zod";

const role = z.enum(["owner", "admin", "member", "billing"]);
const outgoingRole = z.enum(["admin", "member", "billing", "inactive"]);
const operationKey = z.string().min(8).max(120);
const organizationId = z.uuid();
const organizationDto = z.object({
	id: z.uuid(),
	slug: z.string(),
	name: z.string(),
	status: z.string(),
	securityPolicy: z
		.object({
			requireMfa: z.boolean(),
			acceptPasskeyMfa: z.boolean(),
			requiredAuthMethod: z.string().nullable(),
		})
		.optional(),
});
const membershipDto = z.object({
	id: z.uuid(),
	userId: z.string(),
	email: z.email(),
	role,
	status: z.string(),
	billable: z.boolean(),
});
const organizationSnapshotDto = z.object({
	organization: organizationDto,
	membership: membershipDto,
	members: z.array(membershipDto),
	invitations: z.array(
		z.object({
			id: z.uuid(),
			email: z.string(),
			role,
			status: z.string(),
			expiresAt: z.string(),
		}),
	),
	teams: z.array(
		z.object({
			id: z.uuid(),
			name: z.string(),
			membershipIds: z.array(z.uuid()),
		}),
	),
	transfers: z.array(
		z.object({
			id: z.uuid(),
			fromMembershipId: z.uuid(),
			toMembershipId: z.uuid(),
			outgoingRole,
			status: z.string(),
			expiresAt: z.string(),
		}),
	),
	seats: z.object({ capacity: z.number(), occupied: z.number() }),
});
const organizationCommand = z.discriminatedUnion("action", [
	z.strictObject({
		action: z.literal("securityPolicy"),
		requireMfa: z.boolean(),
		acceptPasskeyMfa: z.boolean(),
		requiredAuthMethod: z.enum(["passkey"]).nullable(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("capacity"),
		capacity: z.number().int().min(0).max(100000),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("cancelInvitation"),
		invitationId: z.uuid(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("invite"),
		email: z.email(),
		role: role.exclude(["owner"]),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("acceptInvitation"),
		token: z.string().min(20).max(256),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("membership"),
		membershipId: z.uuid(),
		status: z.enum(["active", "inactive"]),
		role,
		billable: z.boolean(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("createTeam"),
		name: z.string().trim().min(1).max(80),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("removeTeam"),
		teamId: z.uuid(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("addTeamMember"),
		teamId: z.uuid(),
		membershipId: z.uuid(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("removeTeamMember"),
		teamId: z.uuid(),
		membershipId: z.uuid(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("startTransfer"),
		recipientMembershipId: z.uuid(),
		outgoingRole: outgoingRole.optional(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("acceptTransfer"),
		transferId: z.uuid(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("cancelTransfer"),
		transferId: z.uuid(),
		operationKey,
	}),
]);
const protectedOperation = oc.errors({
	UNAUTHORIZED: { status: 401 },
	FORBIDDEN: { status: 403 },
	CONFLICT: { status: 409 },
	PRECONDITION_FAILED: { status: 412 },
	SERVICE_UNAVAILABLE: { status: 503 },
});
export const tenancyContract = {
	summary: protectedOperation
		.route({
			method: "GET",
			path: "/organizations/{organizationId}/summary",
			summary: "Read the current member's organization summary",
		})
		.input(z.strictObject({ organizationId }))
		.output(
			z.object({ organization: organizationDto, membership: membershipDto }),
		),
	list: protectedOperation
		.route({
			method: "GET",
			path: "/organizations",
			summary: "List the authenticated user's current memberships",
		})
		.input(z.strictObject({}))
		.output(z.array(organizationDto)),
	create: protectedOperation
		.route({
			method: "POST",
			path: "/organizations",
			summary: "Create an organization and admit its owner atomically",
		})
		.input(
			z.strictObject({
				name: z.string().trim().min(1).max(80),
				slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
				operationKey,
			}),
		)
		.output(z.object({ id: z.uuid() })),
	get: protectedOperation
		.route({
			method: "GET",
			path: "/organizations/{organizationId}",
			summary: "Read the selected organization under current authorization",
		})
		.input(z.strictObject({ organizationId }))
		.output(organizationSnapshotDto),
	command: protectedOperation
		.route({
			method: "POST",
			path: "/organizations/{organizationId}/commands",
			summary: "Apply an authorized organization lifecycle operation",
		})
		.input(z.strictObject({ organizationId, command: organizationCommand }))
		.output(z.object({ ok: z.literal(true) })),
};
export type OrganizationSnapshotDto = z.infer<typeof organizationSnapshotDto>;
export type OrganizationCommand = z.infer<typeof organizationCommand>;
