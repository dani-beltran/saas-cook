import { implement, ORPCError } from "@orpc/server";
import { contract } from "@saas-cook/api-contracts";
import { exampleCustomerHandlers } from "./example-customers/handlers";
import {
	humanOperation,
	publicOperation,
	resourceOperation,
} from "./resource-boundary";
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
	completion: {
		personalExport: api.completion.personalExport.handler(({ context }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				(r, a) => {
					if ("kind" in a || !r.completion) throw new ORPCError("FORBIDDEN");
					return r.completion.lifecycle.personalExport(a);
				},
			),
		),
		bulkList: api.completion.bulkList.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.bulk.list(a, organizationId);
					},
				),
		),
		bulkDryRun: api.completion.bulkDryRun.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.bulk.dryRun(a, organizationId, input);
					},
				),
		),
		bulkStart: api.completion.bulkStart.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.bulk.start(a, organizationId, input);
					},
				),
		),
		bulkCancel: api.completion.bulkCancel.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.bulk.cancel(a, organizationId, input.id);
					},
				),
		),
		bulkResume: api.completion.bulkResume.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.bulk.resume(a, organizationId, input.id);
					},
				),
		),
		bulkDownload: api.completion.bulkDownload.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.bulk.download(a, organizationId, input.id);
					},
				),
		),
		analyticsGet: api.completion.analyticsGet.handler(({ context, input }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.completion;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.analytics.preferences(a, input.organizationId);
				},
			),
		),
		analyticsSet: api.completion.analyticsSet.handler(({ context, input }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.completion;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.analytics.setPreference(a, input.organizationId, input);
				},
			),
		),
		onboarding: api.completion.onboarding.handler(({ context }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.completion;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.analytics.onboarding(a);
				},
			),
		),
		notificationPreferences: api.completion.notificationPreferences.handler(
			({ context }) =>
				resourceOperation(
					context,
					"00000000-0000-4000-8000-000000000000",
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.notifications.preferences(a);
					},
				),
		),
		notificationSave: api.completion.notificationSave.handler(
			({ context, input }) =>
				resourceOperation(
					context,
					"00000000-0000-4000-8000-000000000000",
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.notifications.setPreferences(a, input);
					},
				),
		),
		notifications: api.completion.notifications.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.notifications.list(a, organizationId);
					},
				),
		),
		notificationRead: api.completion.notificationRead.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.notifications.markRead(a, organizationId, input.id);
					},
				),
		),
		deletionPreview: api.completion.deletionPreview.handler(({ context }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.completion;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.lifecycle.preview(a);
				},
			),
		),
		deletionRequest: api.completion.deletionRequest.handler(
			({ context, input }) =>
				resourceOperation(
					context,
					"00000000-0000-4000-8000-000000000000",
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.lifecycle.request(a, input);
					},
				),
		),
		deletionConfirm: api.completion.deletionConfirm.handler(
			({ context, input }) =>
				resourceOperation(
					context,
					"00000000-0000-4000-8000-000000000000",
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.lifecycle.confirm(a, input.id);
					},
				),
		),
		deletionCancel: api.completion.deletionCancel.handler(
			({ context, input }) =>
				resourceOperation(
					context,
					"00000000-0000-4000-8000-000000000000",
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.lifecycle.cancel(a, input.id);
					},
				),
		),
		deletionStatus: api.completion.deletionStatus.handler(
			({ context, input }) =>
				publicOperation(context, (r) =>
					r.lifecycle.status(input.id, input.receipt),
				),
		),
		unsubscribe: api.completion.unsubscribe.handler(({ context, input }) =>
			publicOperation(context, (r) =>
				r.notifications.unsubscribe(input.receipt),
			),
		),
		webhooks: api.completion.webhooks.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.webhooks(a, organizationId);
					},
				),
		),
		webhookCreate: api.completion.webhookCreate.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.addWebhook(a, organizationId, input);
					},
				),
		),
		webhookCommand: api.completion.webhookCommand.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.webhookCommand(a, organizationId, input);
					},
				),
		),
		webhookDeliveries: api.completion.webhookDeliveries.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.deliveries(a, organizationId, input.endpointId);
					},
				),
		),
		integrations: api.completion.integrations.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.integrations(a, organizationId);
					},
				),
		),
		integrationCreate: api.completion.integrationCreate.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.addIntegration(a, organizationId, input);
					},
				),
		),
		integrationCommand: api.completion.integrationCommand.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.integrationCommand(a, organizationId, input);
					},
				),
		),
		auditGrants: api.completion.auditGrants.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.auditGrants(a, organizationId);
					},
				),
		),
		auditGrant: api.completion.auditGrant.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.grantAudit(a, organizationId, input);
					},
				),
		),
		audit: api.completion.audit.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.settings.audit(a, organizationId, input);
					},
				),
		),
		flags: api.completion.flags.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.completion;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.flags(a, organizationId);
					},
				),
		),
	},
	files: {
		list: api.files.list.handler(
			({ input: { organizationId, ...input }, context }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					(runtime, actor) => {
						if ("kind" in actor) throw new Error("Human principal required");
						return runtime.files.list(actor, organizationId, input.projectId);
					},
				),
		),
		initiate: api.files.initiate.handler(
			({ input: { organizationId, ...input }, context }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					(runtime, actor) => {
						if ("kind" in actor) throw new Error("Human principal required");
						return runtime.files.initiate(actor, organizationId, input);
					},
				),
		),
		finalize: api.files.finalize.handler(
			({ input: { organizationId, ...input }, context }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					(runtime, actor) => {
						if ("kind" in actor) throw new Error("Human principal required");
						return runtime.files.finalize(
							actor,
							organizationId,
							input.projectId,
							input.id,
						);
					},
				),
		),
		download: api.files.download.handler(
			({ input: { organizationId, ...input }, context }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					(runtime, actor) => {
						if ("kind" in actor) throw new Error("Human principal required");
						return runtime.files.download(
							actor,
							organizationId,
							input.projectId,
							input.id,
						);
					},
				),
		),
	},
	platform: {
		accounts: api.platform.accounts.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					(runtime, actor) => {
						if ("kind" in actor) throw new Error("Authorization denied");
						return runtime.platform.accounts(actor, organizationId, input);
					},
				),
		),
		keys: api.platform.keys.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					(runtime, actor) => {
						if ("kind" in actor) throw new Error("Authorization denied");
						return runtime.platform.keys(actor, organizationId, input);
					},
				),
		),
		search: api.platform.search.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					(runtime, actor) => {
						if ("kind" in actor) throw new Error("Authorization denied");
						return runtime.platform.search(actor, organizationId, input);
					},
				),
		),
		activity: api.platform.activity.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					(runtime, actor) => {
						if ("kind" in actor) throw new Error("Authorization denied");
						return runtime.platform.activity(actor, organizationId, input);
					},
				),
		),
	},
	billing: {
		get: api.billing.get.handler(({ context, input }) =>
			resourceOperation(
				context,
				input.organizationId,
				{ mutate: false, serviceAccounts: false },
				(runtime, actor) => {
					if ("kind" in actor) throw new Error("Authorization denied");
					return runtime.billing.get(actor, input.organizationId);
				},
			),
		),
		preview: api.billing.preview.handler(({ context, input }) =>
			humanOperation(context, input.organizationId, (runtime, actor) =>
				runtime.billing.preview(actor, input.organizationId, input.selection),
			),
		),
		command: api.billing.command.handler(({ context, input }) =>
			humanOperation(context, input.organizationId, (runtime, actor) =>
				runtime.billing.command(actor, input.organizationId, input.command),
			),
		),
	},
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
