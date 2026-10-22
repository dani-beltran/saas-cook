import { boundedOperatorRequest } from "@saas-cook/auth/operator-request";
import { publicRequest } from "../../../../lib/request";
import { backoffice } from "../../../../lib/runtime";
/** Returns only the strict masked directory DTO; body and failures never enter application logs. */
export async function POST(request: Request) {
	try {
		request = publicRequest(request);
		backoffice().identity.validateRequest(request);
		request = await boundedOperatorRequest(request, 4096);
		const text = await request.text();
		if (text.length > 4096) throw new Error("Invalid request");
		return Response.json(
			await backoffice().directory(request, JSON.parse(text)),
			{
				headers: { "Cache-Control": "no-store" },
			},
		);
	} catch {
		return Response.json(
			{ error: "unavailable" },
			{ status: 403, headers: { "Cache-Control": "no-store" } },
		);
	}
}
