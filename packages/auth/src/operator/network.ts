import { createHmac, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";

/** Validates an explicit CIDR allowlist; malformed or empty policies are rejected at startup. */
export function operatorNetworks(cidrs: readonly string[]) {
	if (!cidrs.length) throw new Error("Operator network policy required");
	const rules = new BlockList();
	for (const cidr of cidrs) {
		const parts = cidr.split("/");
		const ip = parts[0] ?? "",
			bits = Number(parts[1]),
			family = isIP(ip);
		if (
			parts.length !== 2 ||
			!family ||
			ip.includes("%") ||
			!/^\d+$/.test(parts[1] ?? "") ||
			bits < 0 ||
			bits > (family === 4 ? 32 : 128)
		)
			throw new Error("Invalid operator CIDR");
		rules.addSubnet(ip, bits, family === 4 ? "ipv4" : "ipv6");
	}
	return rules;
}
/** Requires a fresh origin/method/path/query-bound ingress proof and approved source network. */
export function requireOperatorIngress(
	request: Request,
	options: { origin: string; secret: string; networks: BlockList },
	now = Date.now(),
) {
	const url = new URL(request.url),
		source = request.headers.get("x-backoffice-source") ?? "",
		time = request.headers.get("x-backoffice-time") ?? "",
		signature = request.headers.get("x-backoffice-signature") ?? "";
	const family = isIP(source);
	if (
		url.origin !== options.origin ||
		(request.headers.get("host") && request.headers.get("host") !== url.host) ||
		!family ||
		source.includes("%") ||
		!/^\d{10,11}$/.test(time) ||
		!/[a-f0-9]{64}/.test(signature) ||
		signature.length !== 64
	)
		throw new Error("Operator ingress denied");
	const canonical =
		family === 6 ? new URL(`http://[${source}]`).hostname.slice(1, -1) : source;
	if (canonical !== source) throw new Error("Noncanonical operator source");
	const age = now - Number(time) * 1000;
	if (
		age < -5000 ||
		age > 30000 ||
		!options.networks.check(source, family === 4 ? "ipv4" : "ipv6")
	)
		throw new Error("Operator ingress denied");
	const expected = createHmac("sha256", options.secret)
		.update(
			`backoffice-ingress:v1\n${options.origin}\n${request.method}\n${url.pathname}${url.search}\n${time}\n${source}`,
		)
		.digest();
	if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
		throw new Error("Operator ingress denied");
	if (request.headers.has("authorization"))
		throw new Error("Operator bearer credentials unsupported");
	if (
		request.method !== "GET" &&
		request.method !== "HEAD" &&
		request.headers.get("origin") !== options.origin
	)
		throw new Error("Operator origin denied");
	return source;
}
