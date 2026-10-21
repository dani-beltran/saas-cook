import { oc } from "@orpc/contract";
import { z } from "zod";
import { operationKey, publicId } from "./inputs/common";
import {
	invitationFields,
	organizationFields,
	seatCapacity,
	teamFields,
} from "./inputs/tenancy";

const role = z.enum(["owner", "admin", "member", "billing"]);
const outgoingRole = z.enum(["admin", "member", "billing", "inactive"]);
const organizationId = publicId;
const organizationDto = z.object({
	id: publicId,
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
	id: publicId,
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
			id: publicId,
			email: z.string(),
			role,
			status: z.string(),
			expiresAt: z.string(),
		}),
	),
	teams: z.array(
		z.object({
			id: publicId,
			name: z.string(),
			membershipIds: z.array(publicId),
		}),
	),
	transfers: z.array(
		z.object({
			id: publicId,
			fromMembershipId: publicId,
			toMembershipId: publicId,
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
		capacity: seatCapacity,
		operationKey,
	}),
	z.strictObject({
		action: z.literal("cancelInvitation"),
		invitationId: publicId,
		operationKey,
	}),
	z.strictObject({
		action: z.literal("invite"),
		...invitationFields.shape,
		operationKey,
	}),
	z.strictObject({
		action: z.literal("acceptInvitation"),
		token: z.string().min(20).max(256),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("membership"),
		membershipId: publicId,
		status: z.enum(["active", "inactive"]),
		role,
		billable: z.boolean(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("createTeam"),
		...teamFields.shape,
		operationKey,
	}),
	z.strictObject({
		action: z.literal("removeTeam"),
		teamId: publicId,
		operationKey,
	}),
	z.strictObject({
		action: z.literal("addTeamMember"),
		teamId: publicId,
		membershipId: publicId,
		operationKey,
	}),
	z.strictObject({
		action: z.literal("removeTeamMember"),
		teamId: publicId,
		membershipId: publicId,
		operationKey,
	}),
	z.strictObject({
		action: z.literal("startTransfer"),
		recipientMembershipId: publicId,
		outgoingRole: outgoingRole.optional(),
		operationKey,
	}),
	z.strictObject({
		action: z.literal("acceptTransfer"),
		transferId: publicId,
		operationKey,
	}),
	z.strictObject({
		action: z.literal("cancelTransfer"),
		transferId: publicId,
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
		.input(organizationFields.extend({ operationKey }))
		.output(z.object({ id: publicId })),
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
