import type {
	OrganizationCommand,
	OrganizationSnapshotDto,
} from "@common-saas/api-contracts";
import { TenancyError } from "@common-saas/db/tenancy";
import { ORPCError } from "@orpc/server";
import { applicationRuntime } from "./runtime";
import type { RequestContext } from "./service";

async function execute<T>(
	context: RequestContext,
	mutate: boolean,
	work: (
		runtime: ReturnType<typeof applicationRuntime>,
		actor: NonNullable<
			Awaited<
				ReturnType<ReturnType<typeof applicationRuntime>["identity"]["session"]>
			>
		>,
	) => Promise<T>,
) {
	if (!context.request) throw new ORPCError("UNAUTHORIZED");
	// Reject invented fixture headers and absent sessions before initializing services.
	if (!context.request.headers.get("cookie"))
		throw new ORPCError("UNAUTHORIZED");
	try {
		const runtime = applicationRuntime();
		if (mutate && context.request.headers.get("origin") !== runtime.origin)
			throw new ORPCError("FORBIDDEN");
		const actor = await runtime.identity.session(context.request.headers);
		if (!actor) throw new ORPCError("UNAUTHORIZED");
		const currentActor = {
			...actor,
			assertCurrent: () => runtime.identity.assertCurrent(actor),
		};
		return await work(runtime, currentActor);
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		if (error instanceof TenancyError) {
			const code =
				error.code === "CAPACITY" ||
				error.code === "LAST_OWNER" ||
				error.code === "EXPIRED"
					? "PRECONDITION_FAILED"
					: error.code === "CONFLICT"
						? "CONFLICT"
						: "FORBIDDEN";
			throw new ORPCError(code, { message: error.code });
		}
		if (
			error instanceof Error &&
			["Authorization denied", "Authorization expired"].includes(error.message)
		)
			throw new ORPCError("FORBIDDEN");
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "23505"
		)
			throw new ORPCError("CONFLICT");
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "The operation could not be completed",
		});
	}
}
export function listOrganizations(context: RequestContext) {
	return execute(context, false, (runtime, actor) =>
		runtime.tenancy.listOrganizations(actor),
	);
}
export function readOrganizationSummary(
	context: RequestContext,
	organizationId: string,
) {
	return execute(context, false, (runtime, actor) =>
		runtime.tenancy.readSummary(actor, organizationId),
	);
}
export function createOrganization(
	context: RequestContext,
	input: { name: string; slug: string; operationKey: string },
) {
	return execute(context, true, (runtime, actor) =>
		runtime.tenancy.createOrganization(actor, input),
	);
}
export function readOrganization(
	context: RequestContext,
	organizationId: string,
): Promise<OrganizationSnapshotDto> {
	return execute(context, false, async (runtime, actor) => {
		const snapshot = await runtime.tenancy.readOrganization(
			actor,
			organizationId,
		);
		return {
			...snapshot,
			invitations: snapshot.invitations.map((item) => ({
				...item,
				role: item.role as "owner" | "admin" | "member" | "billing",
				expiresAt: item.expiresAt.toISOString(),
			})),
			transfers: snapshot.transfers.map((item) => ({
				...item,
				expiresAt: item.expiresAt.toISOString(),
			})),
		};
	});
}
export function organizationCommand(
	context: RequestContext,
	organizationId: string,
	command: OrganizationCommand,
) {
	return execute(context, true, async (runtime, actor) => {
		const service = runtime.tenancy;
		switch (command.action) {
			case "securityPolicy":
				await service.setSecurityPolicy(actor, organizationId, command);
				break;
			case "capacity":
				await service.setLocalCapacity(actor, organizationId, command.capacity);
				break;
			case "cancelInvitation":
				await service.cancelInvitation(
					actor,
					organizationId,
					command.invitationId,
				);
				break;
			case "invite":
				await service.invite(actor, organizationId, command);
				break;
			case "acceptInvitation":
				await service.acceptInvitation(actor, organizationId, command);
				break;
			case "membership":
				await service.transitionMembership(actor, organizationId, command);
				break;
			case "createTeam":
				await service.createTeam(actor, organizationId, {
					name: command.name,
					slug: `team-${command.operationKey.slice(0, 36)}`,
				});
				break;
			case "removeTeam":
				await service.removeTeam(actor, organizationId, command.teamId);
				break;
			case "addTeamMember":
			case "removeTeamMember":
				await service.setTeamMember(actor, organizationId, {
					...command,
					present: command.action === "addTeamMember",
				});
				break;
			case "startTransfer":
				await service.startTransfer(actor, organizationId, {
					recipientMembershipId: command.recipientMembershipId,
					outgoingRole: command.outgoingRole ?? "member",
				});
				break;
			case "acceptTransfer":
				await service.acceptTransfer(actor, organizationId, command);
				break;
			case "cancelTransfer":
				await service.cancelTransfer(actor, organizationId, command.transferId);
				break;
		}
		return { ok: true as const };
	});
}
