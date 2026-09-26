import { contract } from "@common-saas/api-contracts";
import { implement } from "@orpc/server";
import { echoDiagnostic, type RequestContext } from "./service";

const api = implement(contract).$context<RequestContext>();
export const router = api.router({
	diagnostics: {
		echo: api.diagnostics.echo.handler(({ context, input }) =>
			echoDiagnostic(context, input),
		),
	},
});
