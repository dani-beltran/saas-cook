import { createHmac, timingSafeEqual } from "node:crypto";
import { applicationRuntime } from "@saas-cook/api/runtime";
export const runtime = "nodejs";
/** Provider bridge signs "timestamp.raw-body"; payload is a notification UUID and monotonic suppression reason. */
export async function POST(request: Request) {
	try {
		const app = applicationRuntime(),
			secret = app.feedbackSecret;
		if (!secret || !app.platformModules)
			return new Response(null, { status: 503 });
		const reader = request.body?.getReader();
		if (!reader) return new Response(null, { status: 400 });
		let body = "";
		const decoder = new TextDecoder();
		for (;;) {
			const r = await reader.read();
			if (r.done) break;
			if (body.length + r.value.length > 2048) {
				await reader.cancel();
				return new Response(null, { status: 413 });
			}
			body += decoder.decode(r.value, { stream: true });
		}
		body += decoder.decode();
		const timestamp = request.headers.get("x-email-timestamp") ?? "",
			signature = request.headers.get("x-email-signature") ?? "";
		if (
			!/^\d{10}$/.test(timestamp) ||
			Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
			!/^[a-f0-9]{64}$/.test(signature)
		)
			throw new Error("Invalid feedback");
		const expected = createHmac("sha256", secret)
			.update(`${timestamp}.${body}`)
			.digest();
		if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
			throw new Error("Invalid feedback");
		const value = JSON.parse(body);
		if (
			Object.keys(value).some((k) => !["id", "reason"].includes(k)) ||
			!/^[a-f0-9-]{36}$/.test(value.id) ||
			!["bounce", "complaint"].includes(value.reason)
		)
			throw new Error("Invalid feedback");
		await app.ready();
		await app.platformModules.notifications.feedback(value.id);
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
