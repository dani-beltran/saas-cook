/**
 * Validates a public staff request against the configured origin.
 * Throws for a mismatched URL/Host, bearer credentials or a non-read request
 * without the exact Origin. Returns no identity; callers must verify sessions.
 * Source and forwarding headers never grant access or select rate-limit keys.
 */
export function requireOperatorRequest(
	request: Request,
	options: { origin: string },
): void {
	const url = new URL(request.url);
	if (
		url.origin !== options.origin ||
		(request.headers.has("host") && request.headers.get("host") !== url.host)
	)
		throw new Error("Operator host denied");
	if (request.headers.has("authorization"))
		throw new Error("Operator bearer credentials unsupported");
	if (
		request.method !== "GET" &&
		request.method !== "HEAD" &&
		request.headers.get("origin") !== options.origin
	)
		throw new Error("Operator origin denied");
}
