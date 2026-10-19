import { ORPCError } from "@orpc/server";
import { ApiKeyError, ResourceAuthorizationDenied } from "@saas-cook/authz";
import { BillingError } from "@saas-cook/db/billing";
import { type ResourceActor, ResourceError } from "@saas-cook/db/resources";
import { TenancyError, type TenantActor } from "@saas-cook/db/tenancy";
import { applicationRuntime } from "./runtime";
import type { RequestContext } from "./service";

type Runtime = ReturnType<typeof applicationRuntime>;
/** Every route declares its principal capability. An API key cannot fall back to a cookie. */
export async function resourceOperation<T>(
	context: RequestContext,
	organizationId: string,
	capability: { mutate: boolean; serviceAccounts: boolean },
	work: (runtime: Runtime, actor: ResourceActor) => Promise<T>,
): Promise<T> {
	const failure = (code: string, message?: string) =>
		new ORPCError(code, {
			message,
			data: { requestId: context.requestId },
		});
	try {
		const request = context.request;
		if (!request) throw failure("UNAUTHORIZED");
		const authorization = request.headers.get("authorization");
		if (request.headers.has("authorization") && !capability.serviceAccounts)
			throw failure("FORBIDDEN");
		if (!authorization && !request.headers.get("cookie"))
			throw failure("UNAUTHORIZED");
		const runtime = applicationRuntime();
		// CORS is same-origin only. A bearer credential never makes a browser's cross-origin mutation safe.
		const origin = request.headers.get("origin");
		if (origin && origin !== runtime.origin) throw failure("FORBIDDEN");
		if (capability.mutate && !authorization && origin !== runtime.origin)
			throw failure("FORBIDDEN");
		await runtime.ready();
		let actor: ResourceActor;
		if (authorization) {
			const match = /^Bearer ([A-Za-z0-9_.-]{20,512})$/.exec(authorization);
			if (!match?.[1]) throw failure("UNAUTHORIZED");
			actor = await runtime.keys.authenticate(organizationId, match[1]);
		} else {
			const session = await runtime.identity.session(request.headers);
			if (!session) throw failure("UNAUTHORIZED");
			actor = {
				...session,
				assertCurrent: () => runtime.identity.assertCurrent(session),
			};
		}
		return await work(runtime, actor);
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		if (error instanceof ResourceAuthorizationDenied)
			throw failure("FORBIDDEN");
		if (error instanceof ApiKeyError) {
			if (error.code === "INVALID")
				throw new ORPCError("UNPROCESSABLE_CONTENT", {
					message: "Invalid input",
					data: { requestId: context.requestId, issues: [] },
				});
			throw failure(error.code === "CONFLICT" ? "CONFLICT" : "FORBIDDEN");
		}
		if (
			error instanceof ResourceError ||
			error instanceof TenancyError ||
			error instanceof BillingError
		) {
			const code =
				error.code === "OUTAGE" || error.code === "REVIEW"
					? "SERVICE_UNAVAILABLE"
					: error.code === "CONFLICT"
						? "CONFLICT"
						: error.code === "CAPACITY" || error.code === "DISABLED"
							? "PRECONDITION_FAILED"
							: error.code === "NOT_FOUND"
								? "NOT_FOUND"
								: error.code === "INVALID"
									? "UNPROCESSABLE_CONTENT"
									: "FORBIDDEN";
			if (code === "UNPROCESSABLE_CONTENT")
				throw new ORPCError(code, {
					message: "Invalid input",
					data: { requestId: context.requestId, issues: [] },
				});
			throw failure(code, error.code);
		}
		if (
			error instanceof Error &&
			[
				"Authorization denied",
				"Authorization expired",
				"Invalid API key",
			].includes(error.message)
		)
			throw failure("FORBIDDEN");
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "23505"
		)
			throw failure("CONFLICT");
		throw failure(
			"SERVICE_UNAVAILABLE",
			"The operation could not be completed",
		);
	}
}
export function humanOperation<T>(
	context: RequestContext,
	organizationId: string,
	work: (runtime: Runtime, actor: TenantActor) => Promise<T>,
) {
	return resourceOperation(
		context,
		organizationId,
		{ mutate: true, serviceAccounts: false },
		(runtime, actor) => {
			if ("kind" in actor)
				throw new ORPCError("FORBIDDEN", {
					data: { requestId: context.requestId },
				});
			return work(runtime, actor);
		},
	);
}
