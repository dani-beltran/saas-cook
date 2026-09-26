import { randomUUID } from "node:crypto";
import { contract } from "@common-saas/api-contracts";
import { logEvent, withOperation } from "@common-saas/observability";
import { OpenAPIGenerator } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ORPCError, onError, ValidationError } from "@orpc/server";
import { RPCHandler, type RPCHandlerOptions } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { router } from "./router";
import type { RequestContext } from "./service";

const options: RPCHandlerOptions<RequestContext> = {
	interceptors: [
		onError((error, { context }) => {
			if (error instanceof ORPCError && error.code === "BAD_REQUEST") {
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
			}
		}),
	],
};
const rpc = new RPCHandler(router, options);
const rest = new OpenAPIHandler(router, options);
export async function handleApi(
	request: Request,
	transport: "rpc" | "rest",
): Promise<Response> {
	// Never trust a caller-supplied request ID: it can contain secrets or log injection.
	const context: RequestContext = { requestId: randomUUID(), request };
	return withOperation(
		`api.${transport}`,
		context,
		async () => {
			const handler = transport === "rpc" ? rpc : rest;
			const { response } = await handler.handle(request, {
				prefix: transport === "rpc" ? "/api/rpc" : "/api/v1",
				context,
			});
			const result = response ?? new Response("Not found", { status: 404 });
			result.headers.set("x-request-id", context.requestId);
			result.headers.set("cache-control", "no-store");
			logEvent("api.response", { status: result.status });
			return result;
		},
		{ traceparent: request.headers.get("traceparent") ?? "" },
	);
}
export function specification() {
	return new OpenAPIGenerator({
		schemaConverters: [new ZodToJsonSchemaConverter()],
	}).generate(contract, {
		info: {
			title: "Common SaaS API",
			version: "0.1.0",
			description:
				"Identity-backed organization lifecycle and public runtime diagnostics.",
		},
		servers: [{ url: "/api/v1" }],
	});
}
