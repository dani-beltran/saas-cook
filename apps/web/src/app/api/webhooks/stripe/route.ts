import { applicationRuntime } from "@saas-cook/api/runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
	const reader = request.body?.getReader();
	if (!reader) return new Response(null, { status: 400 });
	const chunks: Uint8Array[] = [];
	let length = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > 262144) {
			await reader.cancel();
			return new Response(null, { status: 413 });
		}
		chunks.push(value);
	}
	try {
		const app = applicationRuntime();
		await app.ready();
		await app.webhook(
			Buffer.concat(chunks),
			request.headers.get("stripe-signature") ?? "",
		);
		return Response.json(
			{ accepted: true },
			{ headers: { "cache-control": "no-store" } },
		);
	} catch {
		return new Response(null, {
			status: 400,
			headers: { "cache-control": "no-store" },
		});
	}
}
