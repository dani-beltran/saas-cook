import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	blocked.addSubnet(network, prefix, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const [network, prefix] of [
	["2001::", 32],
	["2001:db8::", 32],
	["2002::", 16],
] as const)
	blocked.addSubnet(network, prefix, "ipv6");
export function publicAddress(ip: string) {
	const family = isIP(ip);
	return family === 4
		? !blocked.check(ip, "ipv4")
		: family === 6 && global6.check(ip, "ipv6") && !blocked.check(ip, "ipv6");
}
export function endpointUrl(raw: string, allowed: readonly string[]) {
	const u = new URL(raw);
	if (
		u.protocol !== "https:" ||
		u.username ||
		u.password ||
		u.hash ||
		u.search ||
		(u.port && u.port !== "443") ||
		isIP(u.hostname) ||
		!allowed.includes(u.hostname)
	)
		throw new Error("Endpoint host is not allowed");
	return u;
}
export type EndpointTransport = (
	url: string,
	body: string,
	headers: Record<string, string>,
) => Promise<{ status: number; body: string }>;
/** Resolve on every attempt, reject private ranges and pin the checked address through TLS connection. */
export function httpsEndpointTransport(
	allowed: readonly string[],
): EndpointTransport {
	return async (raw, body, headers) => {
		const url = endpointUrl(raw, allowed);
		if (Buffer.byteLength(body) > 16384)
			throw new Error("Endpoint payload too large");
		let dnsTimer: ReturnType<typeof setTimeout> | undefined;
		const addresses = await Promise.race([
			lookup(url.hostname, { all: true }),
			new Promise<never>((_, reject) => {
				dnsTimer = setTimeout(() => reject(new Error("DNS timeout")), 2000);
			}),
		]).finally(() => clearTimeout(dnsTimer));
		if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
			throw new Error("Endpoint address is not public");
		const selected = addresses[0];
		return new Promise((resolve, reject) => {
			const req = request(
				url,
				{
					method: "POST",
					signal: AbortSignal.timeout(3000),
					headers: {
						...headers,
						"content-type": "application/json",
						"content-length": Buffer.byteLength(body),
					},
					servername: url.hostname,
					lookup: (_hostname, opts, cb) => {
						if (opts.all)
							cb(null, [
								{ address: selected.address, family: selected.family },
							]);
						else cb(null, selected.address, selected.family);
					},
				},
				(res) => {
					let data = "",
						length = 0;
					res.on("data", (chunk) => {
						length += chunk.length;
						if (length > 8192) {
							req.destroy();
							reject(new Error("Endpoint response too large"));
						} else data += chunk;
					});
					res.on("end", () =>
						resolve({ status: res.statusCode ?? 0, body: data }),
					);
				},
			);
			req.setTimeout(3000, () => req.destroy(new Error("Endpoint timeout")));
			req.on("error", () => reject(new Error("Endpoint unavailable")));
			req.end(body);
		});
	};
}
