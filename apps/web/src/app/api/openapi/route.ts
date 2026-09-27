import { specification } from "@saas-cook/api";
export const runtime = "nodejs";
export async function GET() {
	return Response.json(await specification(), {
		headers: { "cache-control": "no-store" },
	});
}
