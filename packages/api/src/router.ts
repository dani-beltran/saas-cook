import { contract } from "@common-saas/api-contracts";
import { implement } from "@orpc/server";
import { humanOperation, resourceOperation } from "./resource-boundary";
import { echoDiagnostic, type RequestContext } from "./service";
import {
	createOrganization,
	listOrganizations,
	organizationCommand,
	readOrganization,
	readOrganizationSummary,
} from "./tenancy";

const api = implement(contract).$context<RequestContext>();
export const router = api.router({
	organizations: {
		summary: api.organizations.summary.handler(({ context, input }) =>
			readOrganizationSummary(context, input.organizationId),
		),
		list: api.organizations.list.handler(({ context }) =>
			listOrganizations(context),
		),
		create: api.organizations.create.handler(({ context, input }) =>
			createOrganization(context, input),
		),
		get: api.organizations.get.handler(({ context, input }) =>
			readOrganization(context, input.organizationId),
		),
		command: api.organizations.command.handler(({ context, input }) =>
			organizationCommand(context, input.organizationId, input.command),
		),
	},

	projects: {
		list: api.projects.list.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: false, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.listProjects(actor, input.organizationId, input),
			),
		),
		get: api.projects.get.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: false, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.getProject(actor, input.organizationId, input),
			),
		),
		create: api.projects.create.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: true, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.createProject(actor, input.organizationId, input),
			),
		),
		update: api.projects.update.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: true, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.updateProject(actor, input.organizationId, input),
			),
		),
		delete: api.projects.delete.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: true, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.deleteProject(actor, input.organizationId, input),
			),
		),
		restore: api.projects.restore.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: true, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.restoreProject(actor, input.organizationId, input),
			),
		),
		move: api.projects.move.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: true, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.moveProject(actor, input.organizationId, input),
			),
		),
	},
	workspaces: {
		list: api.workspaces.list.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: false, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.listWorkspaces(actor, input.organizationId, input),
			),
		),
		create: api.workspaces.create.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: true, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.createWorkspace(actor, input.organizationId, input),
			),
		),
		update: api.workspaces.update.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: true, serviceAccounts: true },
				(runtime, actor) =>
					runtime.resources.updateWorkspace(actor, input.organizationId, input),
			),
		),
	},
	grants: {
		create: api.grants.create.handler(({ context, input }) =>
			humanOperation(context, input.organizationId, (runtime, actor) =>
				runtime.resources.grant(actor, input.organizationId, {
					...input,
					expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
				}),
			),
		),
		revoke: api.grants.revoke.handler(({ context, input }) =>
			humanOperation(context, input.organizationId, async (runtime, actor) => {
				await runtime.resources.revokeGrant(actor, input.organizationId, input);
				return { ok: true as const };
			}),
		),
	},
	serviceAccounts: {
		create: api.serviceAccounts.create.handler(({ context, input }) =>
			humanOperation(context, input.organizationId, (runtime, actor) =>
				runtime.keys.createAccount(actor, input.organizationId, input),
			),
		),
		setStatus: api.serviceAccounts.setStatus.handler(({ context, input }) =>
			humanOperation(context, input.organizationId, async (runtime, actor) => {
				await runtime.keys.setAccountStatus(
					actor,
					input.organizationId,
					input.id,
					input.status,
				);
				return { ok: true as const };
			}),
		),
		issue: api.serviceAccounts.issue.handler(({ context, input }) =>
			humanOperation(context, input.organizationId, async (runtime, actor) => {
				const issued = await runtime.keys.issue(actor, input.organizationId, {
					...input,
					expiresAt: new Date(input.expiresAt),
				});
				return { ...issued, expiresAt: issued.expiresAt };
			}),
		),
		rotate: api.serviceAccounts.rotate.handler(({ context, input }) =>
			humanOperation(context, input.organizationId, async (runtime, actor) => {
				const issued = await runtime.keys.rotate(actor, input.organizationId, {
					...input,
					expiresAt: new Date(input.expiresAt),
				});
				return { ...issued, expiresAt: issued.expiresAt };
			}),
		),
		revoke: api.serviceAccounts.revoke.handler(({ context, input }) =>
			humanOperation(context, input.organizationId, async (runtime, actor) => {
				await runtime.keys.revoke(actor, input.organizationId, input.keyId);
				return { ok: true as const };
			}),
		),
	},
	diagnostics: {
		echo: api.diagnostics.echo.handler(({ context, input }) =>
			echoDiagnostic(context, input),
		),
	},
});
