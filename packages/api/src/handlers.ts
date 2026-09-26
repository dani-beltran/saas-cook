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
const maximumBodyBytes = 64 * 1024;
async function boundedRequest(request: Request): Promise<Request | undefined> {
	const declaredLength = Number(request.headers.get("content-length") ?? 0);
	if (!Number.isFinite(declaredLength) || declaredLength > maximumBodyBytes)
		return undefined;
	if (!request.body) return request;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maximumBodyBytes) {
			void reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	// Next wraps Request in a proxy; copying the instance can trigger native private getters.
	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body: body.buffer,
	});
}
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
			const limited = await boundedRequest(request);
			if (!limited || request.method === "OPTIONS") {
				const result = Response.json(
					{
						code: !limited ? "PAYLOAD_TOO_LARGE" : "FORBIDDEN",
						message: !limited
							? "Request body exceeds the limit"
							: "Cross-origin API access is disabled",
						data: { requestId: context.requestId },
					},
					{
						status: !limited ? 413 : 403,
						headers: {
							"x-request-id": context.requestId,
							"cache-control": "no-store",
						},
					},
				);
				if (result.status >= 400)
					logEvent("api.request_rejected", { status: result.status });
				logEvent("api.response", { status: result.status });
				return result;
			}
			context.request = limited;
			const handler = transport === "rpc" ? rpc : rest;
			const { response } = await handler.handle(limited, {
				prefix: transport === "rpc" ? "/api/rpc" : "/api/v1",
				context,
			});
			const result = response ?? new Response("Not found", { status: 404 });
			result.headers.set("x-request-id", context.requestId);
			result.headers.set("cache-control", "no-store");
			if (result.status >= 400)
				logEvent("api.request_rejected", { status: result.status });
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
				"Identity-backed organization lifecycle, scoped Project and workspace resources, and API-key provisioning. Cookie mutations require the configured same-origin Origin header; cross-origin API access is disabled. Keys are scoped to one organization. Request bodies are limited to 64 KiB.",
		},
		servers: [{ url: "/api/v1" }],
	});
}
