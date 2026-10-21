import { backofficeConfig } from "@saas-cook/config/backoffice";

/**
 * Restores the configured public origin after TLS termination. Requires the exact
 * public Host; never trusts a forwarded host or protocol. Callers must still
 * verify the signed ingress assertion before processing this request.
 */
export function publicRequest(request: Request): Request {
	const origin = backofficeConfig().BACKOFFICE_ORIGIN;
	if (request.headers.get("host") !== new URL(origin).host)
		throw new Error("Invalid host");
	const url = new URL(request.url);
	return new Request(`${origin}${url.pathname}${url.search}`, request);
}
