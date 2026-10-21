import {
	operatorNetworks,
	requireOperatorIngress,
} from "@saas-cook/auth/operator-network";
import { backofficeConfig } from "@saas-cook/config/backoffice";
import { type NextRequest, NextResponse } from "next/server";
import { publicRequest } from "./lib/request";
/** Enforces ingress before page rendering or auth; only payload-free liveness is public. */
export function proxy(request: NextRequest) {
	try {
		const c = backofficeConfig();
		requireOperatorIngress(publicRequest(request), {
			origin: c.BACKOFFICE_ORIGIN,
			secret: c.BACKOFFICE_INGRESS_SECRET,
			networks: operatorNetworks(c.BACKOFFICE_CIDRS.split(",")),
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
