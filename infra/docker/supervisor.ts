import { type ChildProcess, spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { readServeEnv } from "@common-saas/config/server";

readServeEnv();
const children: ChildProcess[] = [];
let stopping = false;
let result = 0;
let killTimer: NodeJS.Timeout | undefined;
const heartbeat =
	process.env.WORKER_HEARTBEAT_PATH ?? "/tmp/common-saas-worker.json";
rmSync(heartbeat, { force: true });
function stop(code: number) {
	if (stopping) return;
	stopping = true;
	result = code;
	for (const child of children) child.kill("SIGTERM");
	killTimer = setTimeout(() => {
		for (const child of children)
			if (child.exitCode === null) child.kill("SIGKILL");
		process.exit(1);
	}, 15_000);
}
const webEnv = { ...process.env };
delete webEnv.WORKER_DATABASE_URL;
const workerEnv = { ...process.env };
delete workerEnv.DATABASE_URL;
for (const [name, script, env] of [
	["web", "/app/apps/web/server.js", webEnv],
	["worker", "/app/dist/worker.mjs", workerEnv],
] as const) {
	const child = spawn(process.execPath, [script], { stdio: "inherit", env });
	children.push(child);
	writeFileSync(`/tmp/common-saas-${name}.pid`, String(child.pid));
	child.once("error", () => stop(1));
	child.once("exit", () => {
		if (!stopping) stop(1);
		if (
			children.every(
				(process) => process.exitCode !== null || process.signalCode !== null,
			)
		) {
			clearTimeout(killTimer);
			process.exit(result);
		}
	});
}
process.once("SIGTERM", () => stop(0));
process.once("SIGINT", () => stop(0));
