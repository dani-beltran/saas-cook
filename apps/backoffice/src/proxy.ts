import { requireOperatorRequest } from "@saas-cook/auth/operator-network";
import { backofficeConfig } from "@saas-cook/config/backoffice";
import { type NextRequest, NextResponse } from "next/server";
import { publicRequest } from "./lib/request";
/** Checks host/origin and rejects bearer credentials before page rendering or auth. */
export function proxy(request: NextRequest) {
	try {
		const c = backofficeConfig();
		requireOperatorRequest(publicRequest(request), {
			origin: c.BACKOFFICE_ORIGIN,
		});
		return NextResponse.next();
	} catch {
		return new NextResponse("Unavailable", {
			status: 503,
			headers: { "Cache-Control": "no-store" },
		});
	}
}
export const config = {
	matcher: ["/((?!_next/static|_next/image|health/live|favicon.ico).*)"],
};
