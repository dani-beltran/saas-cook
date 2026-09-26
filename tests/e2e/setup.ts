import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { FullConfig } from "@playwright/test";
import { createTestInstallation } from "../../packages/testing/src/installation";

export default async function setup(config: FullConfig) {
	const baseURL = config.projects[0]?.use.baseURL;
	if (!baseURL) throw new Error("Browser acceptance requires a base URL");
	// Fail on an occupied test port rather than accidentally probing another application.
	const port = new URL(baseURL).port;
	const probe = createServer();
	await new Promise<void>((resolve, reject) => {
		probe.once("error", reject);
		probe.listen(Number(port), "127.0.0.1", () => {
			probe.close((error) => (error ? reject(error) : resolve()));
		});
	});
	const installation = await createTestInstallation();
	const previousEnv = Object.fromEntries(
		Object.keys(installation.env).map((key) => [key, process.env[key]]),
	);
	Object.assign(process.env, installation.env);
	let server: ChildProcess | undefined;
	let logs = "";
	async function cleanup() {
		try {
			if (
				server?.pid &&
				server.exitCode === null &&
				server.signalCode === null
			) {
				const exited = once(server, "exit");
				server.kill("SIGTERM");
				const deadline = setTimeout(() => server?.kill("SIGKILL"), 10_000);
				try {
					await exited;
				} finally {
					clearTimeout(deadline);
				}
			}
			await mkdir("artifacts/playwright-results", { recursive: true });
			await writeFile("artifacts/playwright-results/server.log", logs);
		} finally {
			for (const [key, value] of Object.entries(previousEnv)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			await installation.cleanup();
		}
	}
	try {
		server = spawn(
			process.execPath,
			["apps/web/.next/standalone/apps/web/server.js"],
			{
				env: {
					PATH: process.env.PATH,
					NODE_ENV: "production",
					HOSTNAME: "127.0.0.1",
					PORT: port,
					APP_ORIGIN: baseURL,
					APP_NAME: "Common SaaS",
					DEFAULT_LOCALE: "en",
					DATABASE_URL: installation.env.DATABASE_URL,
					IDENTITY_DATABASE_URL: installation.env.IDENTITY_DATABASE_URL,
					CONTROL_DATABASE_URL: installation.env.CONTROL_DATABASE_URL,
					INSTALLATION_ID: installation.env.INSTALLATION_ID,
					AUTH_SECRET: installation.env.AUTH_SECRET,
					OPENFGA_API_URL: installation.env.OPENFGA_API_URL,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		server.stdout?.on("data", (chunk) => {
			logs += chunk;
		});
		server.stderr?.on("data", (chunk) => {
			logs += chunk;
		});
		let startError: Error | undefined;
		server.on("error", (error) => {
			startError = error;
		});
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			if (startError) throw startError;
			if (server.exitCode !== null || server.signalCode !== null)
				throw new Error(
					"Browser application exited before readiness; see artifacts/playwright-results/server.log",
				);
			const ready = await fetch(new URL("/api/health", baseURL), {
				signal: AbortSignal.timeout(2_000),
			}).catch(() => undefined);
			if (ready?.ok) return cleanup;
			await delay(200);
		}
		throw new Error(
			"Browser application did not become ready; see artifacts/playwright-results/server.log",
		);
	} catch (error) {
		await cleanup();
		throw error;
	}
}
