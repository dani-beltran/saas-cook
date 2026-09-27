import { contract } from "@common-saas/api-contracts";
import { implement } from "@orpc/server";
import { exampleCustomerHandlers } from "./example-customers/handlers";
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
		list: api.projects.list.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: true },
					(runtime, actor) =>
						runtime.resources.listProjects(actor, organizationId, input),
				),
		),
		get: api.projects.get.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: true },
					(runtime, actor) =>
						runtime.resources.getProject(actor, organizationId, input),
				),
		),
		create: api.projects.create.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: true },
					(runtime, actor) =>
						runtime.resources.createProject(actor, organizationId, input),
				),
		),
		update: api.projects.update.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: true },
					(runtime, actor) =>
						runtime.resources.updateProject(actor, organizationId, input),
				),
		),
		delete: api.projects.delete.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: true },
					(runtime, actor) =>
						runtime.resources.deleteProject(actor, organizationId, input),
				),
		),
		restore: api.projects.restore.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: true },
					(runtime, actor) =>
						runtime.resources.restoreProject(actor, organizationId, input),
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
			humanOperation(context, input.organizationId, (runtime, actor) =>
				runtime.keys.setAccountStatus(actor, input.organizationId, input),
			),
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
	exampleCustomers: {
		list: api.exampleCustomers.list.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					(runtime, actor) =>
						exampleCustomerHandlers.list(runtime, actor, organizationId, input),
				),
		),
		get: api.exampleCustomers.get.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					(runtime, actor) =>
						exampleCustomerHandlers.get(runtime, actor, organizationId, input),
				),
		),
		create: api.exampleCustomers.create.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					(runtime, actor) =>
						exampleCustomerHandlers.create(
							runtime,
							actor,
							organizationId,
							input,
						),
				),
		),
		update: api.exampleCustomers.update.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					(runtime, actor) =>
						exampleCustomerHandlers.update(
							runtime,
							actor,
							organizationId,
							input,
						),
				),
		),
		delete: api.exampleCustomers.delete.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					(runtime, actor) =>
						exampleCustomerHandlers.delete(
							runtime,
							actor,
							organizationId,
							input,
						),
				),
		),
	},
	diagnostics: {
		echo: api.diagnostics.echo.handler(({ context, input }) =>
			echoDiagnostic(context, input),
		),
	},
});
