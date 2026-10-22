import { boundedOperatorRequest } from "@saas-cook/auth/operator-request";
import { publicRequest } from "../../../../lib/request";
import { backoffice } from "../../../../lib/runtime";
/** Returns only the strict metadata DTO; body and failures never enter application logs. */
export async function POST(request: Request) {
	try {
		request = publicRequest(request);
		backoffice().identity.validateRequest(request);
		request = await boundedOperatorRequest(request, 2048);
		const text = await request.text();
		if (text.length > 2048) throw new Error("Invalid request");
		return Response.json(await backoffice().lookup(request, JSON.parse(text)), {
			headers: { "Cache-Control": "no-store" },
		});
	} catch {
		return Response.json(
			{ error: "unavailable" },
			{ status: 403, headers: { "Cache-Control": "no-store" } },
		);
	}
}
