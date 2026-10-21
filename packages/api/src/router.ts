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
	dataJobs: {
		list: api.dataJobs.list.handler(({ context, input: { organizationId } }) =>
			resourceOperation(
				context,
				organizationId,
				{ mutate: false, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.platformModules;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.dataJobs.list(a, organizationId);
				},
			),
		),
		dryRun: api.dataJobs.dryRun.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.dataJobs.dryRun(a, organizationId, input);
					},
				),
		),
		start: api.dataJobs.start.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.dataJobs.start(a, organizationId, input);
					},
				),
		),
		cancel: api.dataJobs.cancel.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.dataJobs.cancel(a, organizationId, input.id);
					},
				),
		),
		resume: api.dataJobs.resume.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.dataJobs.resume(a, organizationId, input.id);
					},
				),
		),
		download: api.dataJobs.download.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.dataJobs.download(a, organizationId, input.id);
					},
				),
		),
	},
	privacy: {
		exportAccount: api.privacy.exportAccount.handler(({ context }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				(r, a) => {
					if ("kind" in a || !r.platformModules)
						throw new ORPCError("FORBIDDEN");
					return r.platformModules.privacy.personalExport(a);
				},
			),
		),
		previewDeletion: api.privacy.previewDeletion.handler(({ context }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.platformModules;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.privacy.preview(a);
				},
			),
		),
		requestDeletion: api.privacy.requestDeletion.handler(({ context, input }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.platformModules;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.privacy.request(a, input);
				},
			),
		),
		confirmDeletion: api.privacy.confirmDeletion.handler(({ context, input }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.platformModules;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.privacy.confirm(a, input.id);
				},
			),
		),
		cancelDeletion: api.privacy.cancelDeletion.handler(({ context, input }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.platformModules;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.privacy.cancel(a, input.id);
				},
			),
		),
		deletionStatus: api.privacy.deletionStatus.handler(({ context, input }) =>
			publicOperation(context, (r) =>
				r.privacy.status(input.id, input.receipt),
			),
		),
	},
	analytics: {
		preferences: api.analytics.preferences.handler(({ context, input }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.platformModules;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.analytics.preferences(a, input.organizationId);
				},
			),
		),
		setPreference: api.analytics.setPreference.handler(({ context, input }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: true, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.platformModules;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.analytics.setPreference(a, input.organizationId, input);
				},
			),
		),
		completeOnboarding: api.analytics.completeOnboarding.handler(
			({ context }) =>
				resourceOperation(
					context,
					"00000000-0000-4000-8000-000000000000",
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.analytics.onboarding(a);
					},
				),
		),
	},
	notifications: {
		preferences: api.notifications.preferences.handler(({ context }) =>
			resourceOperation(
				context,
				"00000000-0000-4000-8000-000000000000",
				{ mutate: false, serviceAccounts: false },
				async (runtime, a) => {
					if ("kind" in a) throw new ORPCError("FORBIDDEN");
					const r = runtime.platformModules;
					if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
					return r.notifications.preferences(a);
				},
			),
		),
		savePreferences: api.notifications.savePreferences.handler(
			({ context, input }) =>
				resourceOperation(
					context,
					"00000000-0000-4000-8000-000000000000",
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.notifications.setPreferences(a, input);
					},
				),
		),
		list: api.notifications.list.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.notifications.list(a, organizationId);
					},
				),
		),
		markRead: api.notifications.markRead.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.notifications.markRead(a, organizationId, input.id);
					},
				),
		),
		unsubscribe: api.notifications.unsubscribe.handler(({ context, input }) =>
			publicOperation(context, (r) =>
				r.notifications.unsubscribe(input.receipt),
			),
		),
	},
	organizationSettings: {
		webhooks: api.organizationSettings.webhooks.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.webhooks(a, organizationId);
					},
				),
		),
		createWebhook: api.organizationSettings.createWebhook.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.addWebhook(a, organizationId, input);
					},
				),
		),
		webhookCommand: api.organizationSettings.webhookCommand.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.webhookCommand(
							a,
							organizationId,
							input,
						);
					},
				),
		),
		webhookDeliveries: api.organizationSettings.webhookDeliveries.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.deliveries(
							a,
							organizationId,
							input.endpointId,
						);
					},
				),
		),
		integrations: api.organizationSettings.integrations.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.integrations(a, organizationId);
					},
				),
		),
		createIntegration: api.organizationSettings.createIntegration.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.addIntegration(
							a,
							organizationId,
							input,
						);
					},
				),
		),
		integrationCommand: api.organizationSettings.integrationCommand.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.integrationCommand(
							a,
							organizationId,
							input,
						);
					},
				),
		),
		auditGrants: api.organizationSettings.auditGrants.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.auditGrants(a, organizationId);
					},
				),
		),
		grantAudit: api.organizationSettings.grantAudit.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: true, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.grantAudit(a, organizationId, input);
					},
				),
		),
		audit: api.organizationSettings.audit.handler(
			({ context, input: { organizationId, ...input } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
						if (!r) throw new ORPCError("SERVICE_UNAVAILABLE");
						return r.organizationSettings.audit(a, organizationId, input);
					},
				),
		),
		flags: api.organizationSettings.flags.handler(
			({ context, input: { organizationId } }) =>
				resourceOperation(
					context,
					organizationId,
					{ mutate: false, serviceAccounts: false },
					async (runtime, a) => {
						if ("kind" in a) throw new ORPCError("FORBIDDEN");
						const r = runtime.platformModules;
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
