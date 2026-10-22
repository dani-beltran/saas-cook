// Read-only benchmark observer, mounted into the exact customer image. No identities,
// payloads, URLs or authorization decisions are retained or changed by this observer.
const { AsyncLocalStorage } = require("node:async_hooks");
const { channel } = require("node:diagnostics_channel");
const { readFileSync, writeFileSync } = require("node:fs");
const { Server } = require("node:http");
const { tmpdir } = require("node:os");
const directory = tmpdir();
const revoking = new AsyncLocalStorage();
let window = { start: Number.POSITIVE_INFINITY, end: 0 };
const fence = {},
	revocationFence = {},
	tuples = {};
let checks = 0,
	writes = 0,
	malformed = 0,
	maxFence = 0,
	maxRevocationFence = 0;
const fenceThreshold = {
	limitExclusiveMs: 100,
	count: 0,
	below: 0,
	atOrAbove: 0,
};
const measured = () => Date.now() >= window.start && Date.now() <= window.end;
function bucket(histogram, value) {
	const upper = Math.min(60001, Math.ceil(value));
	histogram[upper] = (histogram[upper] ?? 0) + 1;
}
const emit = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
	if (event !== "request") return Reflect.apply(emit, this, [event, ...args]);
	const request = args[0];
	const isRevocation =
		(request.method === "DELETE" && /\/resource-grants\//.test(request.url)) ||
		/\/grants\/revoke(?:\?|$)/.test(request.url);
	return revoking.run(isRevocation, () =>
		Reflect.apply(emit, this, [event, ...args]),
	);
};
channel("saas-cook.authorization.fence-wait").subscribe((message) => {
	if (!measured()) return;
	if (!Number.isFinite(message.milliseconds) || message.milliseconds < 0) {
		malformed++;
		return;
	}
	fenceThreshold.count++;
	if (message.milliseconds < fenceThreshold.limitExclusiveMs)
		fenceThreshold.below++;
	else fenceThreshold.atOrAbove++;
	bucket(fence, message.milliseconds);
	maxFence = Math.max(maxFence, message.milliseconds);
	if (revoking.getStore()) {
		bucket(revocationFence, message.milliseconds);
		maxRevocationFence = Math.max(maxRevocationFence, message.milliseconds);
	}
});
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
	const url = input instanceof Request ? input.url : String(input);
	if (measured() && url.startsWith(`${process.env.OPENFGA_API_URL}/stores/`)) {
		if (url.endsWith("/write")) writes++;
		if (url.endsWith("/check")) {
			checks++;
			try {
				const values = JSON.parse(init.body).contextual_tuples?.tuple_keys;
				if (!Array.isArray(values)) malformed++;
				else bucket(tuples, values.length);
			} catch {
				malformed++;
			}
		}
	}
	return Reflect.apply(originalFetch, this, [input, init]);
};
setInterval(() => {
	try {
		window = JSON.parse(
			readFileSync(`${directory}/phase8-window.json`, "utf8"),
		);
	} catch {
		/* The driver sets the measurement interval after startup. */
	}
	if (!Number.isFinite(window.start)) return;
	writeFileSync(
		`${directory}/phase8-observer-${process.pid}.json`,
		JSON.stringify({
			role: process.argv[1]?.endsWith("/server.js")
				? "web"
				: process.argv[1]?.endsWith("/worker.mjs")
					? "worker"
					: "supervisor",
			window,
			sampledAt: Date.now(),
			fence,
			fenceThreshold,
			revocationFence,
			tuples,
			checks,
			writes,
			malformed,
			maxFence,
			maxRevocationFence,
		}),
	);
}, 200).unref();
