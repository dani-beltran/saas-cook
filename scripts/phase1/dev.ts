import { spawn } from "node:child_process";
import { readServeEnv } from "@common-saas/config/server";

const env = { ...process.env };
delete env.MIGRATION_DATABASE_URL;
delete env.TEST_DATABASE_ADMIN_URL;
delete env.CONTROL_ADMIN_DATABASE_URL;
delete env.OWNER_RECOVERY_SECRET;
readServeEnv(env);
const webEnv = { ...env };
delete webEnv.WORKER_DATABASE_URL;
delete webEnv.SMTP_USERNAME;
delete webEnv.SMTP_PASSWORD;
const workerEnv = { ...env };
delete workerEnv.DATABASE_URL;
delete workerEnv.IDENTITY_DATABASE_URL;
const children = [
	spawn(
		process.execPath,
		["../../node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"],
		{ cwd: "apps/web", stdio: "inherit", env: webEnv },
	),
	spawn(process.execPath, ["--import", "tsx", "apps/worker/src/index.ts"], {
		stdio: "inherit",
		env: workerEnv,
	}),
];
let stopping = false;
function stop(code: number) {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill("SIGTERM");
	setTimeout(() => process.exit(code), 12_000).unref();
	process.exitCode = code;
}
for (const child of children) {
	child.on("error", () => stop(1));
	child.on("exit", () => stop(stopping ? 0 : 1));
}
process.once("SIGTERM", () => stop(0));
process.once("SIGINT", () => stop(0));
