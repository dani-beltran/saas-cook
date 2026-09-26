import { randomUUID } from "node:crypto";
import { applicationRuntime } from "@common-saas/api/runtime";
import { logEvent, withOperation } from "@common-saas/observability";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: Request) {
	return withOperation(
		"identity.http",
		{ requestId: randomUUID() },
		async () => {
			try {
				return await applicationRuntime().identity.handler(request);
			} catch {
				logEvent("identity.runtime_unavailable", { status: 503 });
				return Response.json(
					{ error: "Identity unavailable" },
					{
						status: 503,
						headers: {
							"Cache-Control": "no-store",
							"Referrer-Policy": "no-referrer",
						},
					},
				);
			}
		},
	);
}

export { handler as GET, handler as POST };
