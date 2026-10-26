import { spawn } from "node:child_process";

// Start Next in a fresh process so Node's env-file flag is not copied into NODE_OPTIONS.
// The app directory also anchors next-intl's relative configuration path.
const child = spawn(
	process.execPath,
	[
		"../../node_modules/next/dist/bin/next",
		"dev",
		"--hostname",
		"127.0.0.1",
		"--port",
		"3001",
	],
	{ cwd: "apps/backoffice", stdio: "inherit", env: process.env },
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		stopping = true;
		child.kill(signal);
	});
}
child.on("error", () => {
	process.exitCode = 1;
});
child.on("exit", (code) => {
	process.exitCode = stopping ? 0 : (code ?? 1);
});
