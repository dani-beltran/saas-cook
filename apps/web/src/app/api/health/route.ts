import { applicationRuntime } from "@saas-cook/api/runtime";
import { readWebEnv } from "@saas-cook/config/server";
import { checkDatabase } from "@saas-cook/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
	try {
		const env = readWebEnv();
		await checkDatabase(env.DATABASE_URL);
		await applicationRuntime().ready();
		return Response.json(
			{ status: "ready", phase: 2 },
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch {
		return Response.json(
			{ status: "unready" },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
