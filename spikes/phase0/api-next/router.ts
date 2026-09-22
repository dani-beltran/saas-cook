import { implement } from "@orpc/server";
import { contract } from "./contracts";
import { ProjectFixtureService, type Context } from "./service";
export function createRouter(service = new ProjectFixtureService()) {
	const api = implement(contract).$context<Context>();
	return api.router({
		read: api.read.handler(({ context, input }) =>
			service.read(context, input),
		),
		update: api.update.handler(({ context, input }) =>
			service.update(context, input),
		),
	});
}
export type Router = ReturnType<typeof createRouter>;
