import { applicationRuntime } from "@common-saas/api/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: Request) {
	try { return await applicationRuntime().identity.handler(request); }
	catch { return Response.json({ error: "Identity unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
}
export { handler as GET, handler as POST };
