import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/** Only a configured ingress can attest a source. Ordinary forwarding headers have no authority. */
export function ingressSource(
	request: Request,
	secret: string | undefined,
	now = Date.now(),
): string | null {
	if (!secret) return "unattributed";
	const source = request.headers.get("x-common-saas-source") ?? "";
	const timestamp = request.headers.get("x-common-saas-source-time") ?? "";
	const signature = request.headers.get("x-common-saas-source-signature") ?? "";
	const family = isIP(source);
	if (
		!family ||
		source.includes("%") ||
		!/^[1-9][0-9]{9,10}$/.test(timestamp) ||
		!/^[a-f0-9]{64}$/.test(signature)
	)
		return null;
	const canonical =
		family === 6 ? new URL(`http://[${source}]`).hostname.slice(1, -1) : source;
	if (canonical !== source) return null;
	const age = now - Number(timestamp) * 1000;
	if (age < -5000 || age > 30000) return null;
	const expected = createHmac("sha256", secret)
		.update(
			`common-saas-ingress:v1\n${timestamp}\n${request.method}\n${new URL(request.url).pathname}\n${source}`,
		)
		.digest();
	return timingSafeEqual(Buffer.from(signature, "hex"), expected)
		? source
		: null;
}
