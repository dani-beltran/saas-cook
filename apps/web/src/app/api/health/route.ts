import { readWebEnv } from "@common-saas/config/server";
import { checkDatabase } from "@common-saas/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
	try {
		const env = readWebEnv();
		await checkDatabase(env.DATABASE_URL);
		return Response.json(
			{ status: "ready", phase: 1 },
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch {
		return Response.json(
			{ status: "unready" },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
