import { spawn } from "node:child_process";
import { createBackofficeRuntime } from "@saas-cook/backoffice";

async function start() {
	const runtime = createBackofficeRuntime();
	try {
		await runtime.ready();
	} finally {
		await runtime.close();
	}
	const child = spawn(process.execPath, ["/app/apps/backoffice/server.js"], {
		stdio: "inherit",
		env: process.env,
	});
	let stopping: "SIGTERM" | "SIGINT" | undefined;
	let forced = false;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	for (const signal of ["SIGTERM", "SIGINT"] as const)
		process.on(signal, () => {
			if (stopping) return;
			stopping = signal;
			child.kill(signal);
			deadline = setTimeout(() => {
				forced = true;
				child.kill("SIGKILL");
			}, 15000);
			deadline.unref();
		});
	child.once("error", () => {
		process.exitCode = 1;
	});
	child.once("exit", (code) => {
		if (deadline) clearTimeout(deadline);
		// Next exits with 128 + signal after draining. Only a requested, bounded stop is successful.
		const expected = stopping === "SIGTERM" ? 143 : 130;
		process.exitCode =
			stopping && !forced && (code === 0 || code === expected)
				? 0
				: (code ?? 1);
	});
}
void start().catch(() => {
	console.error("Backoffice startup validation failed");
	process.exitCode = 1;
});
