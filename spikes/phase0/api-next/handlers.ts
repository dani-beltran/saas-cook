import { randomUUID } from "node:crypto";
import { ORPCError, ValidationError, onError } from "@orpc/server";
import { RPCHandler, type RPCHandlerOptions } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createRouter } from "./router";
import { contract } from "./contracts";
import type { Actor, Context } from "./service";

const fixtures: Record<string, Actor> = {
	"phase0-alpha": { userId: "u1", organizationId: "alpha", writable: true },
	"phase0-beta": { userId: "u2", organizationId: "beta", writable: true },
	"phase0-reader": { userId: "u3", organizationId: "alpha", writable: false },
};
export function createHandlers(
	enabled: () => boolean = () => process.env.PHASE0_API_FIXTURES === "1",
) {
	const router = createRouter();
	const options: RPCHandlerOptions<Context> = {
		interceptors: [
			onError((error, { context }) => {
				if (error instanceof ORPCError && error.code === "BAD_REQUEST")
					throw new ORPCError("UNPROCESSABLE_CONTENT", {
						status: 422,
						message: "Invalid input",
						data: {
							requestId: context.requestId,
							issues:
								error.cause instanceof ValidationError
									? error.cause.issues.map((issue) => ({
											path: (issue.path ?? []).map((segment) =>
												typeof segment === "object"
													? String(segment.key)
													: segment,
											),
											message: "Invalid value",
										}))
									: [],
						},
					});
			}),
		],
	};
	const rpc = new RPCHandler(router, options),
		rest = new OpenAPIHandler(router, options);
	return async (request: Request, transport: "rpc" | "rest") => {
		if (!enabled())
			return new Response("Phase 0 fixtures disabled", { status: 503 });
		const context: Context = {
			actor:
				fixtures[
					request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
				] ?? null,
			requestId: randomUUID(),
		};
		const handler = transport === "rpc" ? rpc : rest;
		const { response } = await handler.handle(request, {
			prefix: transport === "rpc" ? "/api/rpc" : "/api/v1",
			context,
		});
		const result = response ?? new Response("Not found", { status: 404 });
		result.headers.set("x-request-id", context.requestId);
		result.headers.set("cache-control", "no-store");
		return result;
	};
}
// Next can bundle Route Handlers independently. This process-local singleton keeps
// the synthetic store shared across transports; production must use durable SQL.
const fixtureRuntime = globalThis as typeof globalThis & {
	__commonSassPhase0Handler?: ReturnType<typeof createHandlers>;
};
export const handle = (fixtureRuntime.__commonSassPhase0Handler ??=
	createHandlers());
export async function specification() {
	return new OpenAPIGenerator({
		schemaConverters: [new ZodToJsonSchemaConverter()],
	}).generate(contract, {
		info: { title: "Phase 0 API", version: "0.0.0" },
		servers: [{ url: "/api/v1" }],
	});
}
