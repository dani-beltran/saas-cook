import { publicRequest } from "../../../lib/request";
import { backoffice } from "../../../lib/runtime";

/**
 * Checks the current verified staff session through the identity lifecycle boundary.
 * Returns only success status; invalid/expired sessions or unavailable dependencies
 * return 403. No identity details or credential payloads are disclosed or cached.
 */
export async function POST(request: Request) {
	try {
		await backoffice().identity.withSession(
			publicRequest(request),
			async () => undefined,
		);
		return new Response(null, {
			status: 204,
			headers: { "Cache-Control": "no-store" },
		});
	} catch {
		return new Response(null, {
			status: 403,
			headers: { "Cache-Control": "no-store" },
		});
	}
}
