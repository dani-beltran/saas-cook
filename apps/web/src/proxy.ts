import { type NextRequest, NextResponse } from "next/server";

const loopbackHosts = new Set(["localhost", "127.0.0.1"]);

/** Keep local page navigation on the same origin used by cookies and WebAuthn. */
export function proxy(request: NextRequest) {
	if (request.method !== "GET" && request.method !== "HEAD")
		return NextResponse.next();
	const canonical = URL.parse(process.env.APP_ORIGIN ?? "");
	const incoming = URL.parse(`http://${request.headers.get("host") ?? ""}`);
	if (
		!canonical ||
		!incoming ||
		canonical.protocol !== "http:" ||
		!loopbackHosts.has(canonical.hostname) ||
		!loopbackHosts.has(incoming.hostname) ||
		incoming.port !== canonical.port ||
		incoming.hostname === canonical.hostname
	)
		return NextResponse.next();
	canonical.pathname = request.nextUrl.pathname;
	canonical.search = request.nextUrl.search;
	const response = NextResponse.redirect(canonical, 307);
	response.headers.set("Cache-Control", "no-store");
	response.headers.set("Referrer-Policy", "no-referrer");
	return response;
}

export const config = {
	matcher: ["/", "/en/:path*", "/es/:path*", "/auth/:path*"],
};
