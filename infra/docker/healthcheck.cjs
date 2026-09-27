const fs = require("node:fs");
(async () => {
	const heartbeat = JSON.parse(
		fs.readFileSync(
			process.env.WORKER_HEARTBEAT_PATH || "/tmp/saas-cook-worker.json",
			"utf8",
		),
	);
	if (Date.now() - heartbeat.at > 10000 || heartbeat.at > Date.now() + 1000)
		throw new Error("stale");
	process.kill(heartbeat.pid, 0);
	const response = await fetch(
		`http://127.0.0.1:${process.env.PORT || 3000}/api/health`,
		{ signal: AbortSignal.timeout(3000) },
	);
	if (!response.ok || (await response.json()).status !== "ready")
		throw new Error("not ready");
})().catch(() => process.exit(1));
