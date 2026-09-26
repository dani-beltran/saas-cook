import { contract } from "@common-saas/api-contracts";
import { implement } from "@orpc/server";
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
	diagnostics: {
		echo: api.diagnostics.echo.handler(({ context, input }) =>
			echoDiagnostic(context, input),
		),
	},
});
