import { backoffice } from "../../../lib/runtime";
/** Private bounded dependency readiness; failures disclose no infrastructure details. */
export async function GET() {
	try {
		await backoffice().ready();
		return Response.json({ status: "ready" });
	} catch {
		return Response.json({ status: "unavailable" }, { status: 503 });
	}
}
