import { execFile } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createServer, type Socket } from "node:net";
import { promisify } from "node:util";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
	closeFixturePool,
	createFixturePool,
	type FixturePoolBoundary,
} from "../../packages/testing/src/pool";
import { finalPerformanceOutcome } from "./performance-assertions";
import { performanceFixtureEnvironment } from "./performance-environment";
import {
	cleanupPerformanceResources,
	createPerformanceFailureBoundary,
} from "./performance-failure";

const boundaries: FixturePoolBoundary[] = [
	"installation-application-admin",
	"installation-control-admin",
	"installation-control-cleanup",
	"resource-application",
	"resource-web",
	"resource-identity",
	"resource-control",
];

describe("benchmark dependency failure containment", () => {
	it("rejects a direct driver without owning IPC before any fixture setup", async () => {
		const profile = {
			version: 1 as const,
			id: "a".repeat(32),
			ports: {
				postgres: 51001,
				control: 51002,
				openfga: 51003,
				storage: 51004,
				mailpit: 51005,
			},
		};
		const failed = await promisify(execFile)(
			process.execPath,
			["--import", "tsx", "scripts/phase8/performance.ts", "--smoke"],
			{
				env: {
					...process.env,
					...performanceFixtureEnvironment(profile),
					PHASE8_BENCHMARK_ENVIRONMENT: JSON.stringify(profile),
				},
				timeout: 10_000,
			},
		).then(
			() => null,
			(error: { stderr: string; code: number }) => ({
				stderr: error.stderr,
				code: error.code,
			}),
		);
		expect(failed?.code).toBe(1);
		expect(failed?.stderr).toContain(
			"Run the benchmark through its isolated service wrapper",
		);
		expect(failed?.stderr).not.toContain("local_phase1");
	}, 15_000);

	it.each(boundaries)(
		"contains idle pool and checked-out client errors at %s",
		async (boundary) => {
			const diagnose = vi.fn();
			const failure = createPerformanceFailureBoundary(diagnose);
			const pool = createFixturePool({ max: 1 }, boundary, {
				onDependencyError: failure.onDependencyError,
				poolTimeoutMs: 10_000,
			});
			const checkedOut = new EventEmitter();
			pool.emit("connect", checkedOut);
			const privateError = Object.assign(
				new Error("synthetic-private-password"),
				{
					client: {
						connectionParameters: { password: "synthetic-private-password" },
					},
				},
			);
			// Either unhandled EventEmitter error would throw before finally can execute.
			expect(() => checkedOut.emit("error", privateError)).not.toThrow();
			expect(() => pool.emit("error", privateError)).not.toThrow();
			expect(failure.signal.aborted).toBe(true);
			expect(failure.signal.reason.message).toBe(
				"Performance fixture dependency failed",
			);
			expect([...failure.boundaries]).toEqual([boundary]);
			expect(diagnose.mock.calls).toEqual([[boundary]]);
			expect(JSON.stringify(diagnose.mock.calls)).not.toContain(
				"synthetic-private-password",
			);
			await closeFixturePool(pool);
		},
	);

	it("aborts active work and retains failed outcome when cleanup also rejects or hangs", async () => {
		const diagnose = vi.fn();
		const failure = createPerformanceFailureBoundary(diagnose);
		const completed: string[] = [];
		const work = new Promise<void>((_, reject) => {
			failure.signal.addEventListener(
				"abort",
				() => reject(failure.signal.reason),
				{ once: true },
			);
		});
		failure.onDependencyError("installation-application-admin");
		await expect(work).rejects.toThrow("Performance fixture dependency failed");
		const failedCleanup = await cleanupPerformanceResources([
			{
				label: "image",
				run: async () => {
					completed.push("image");
				},
			},
			{
				label: "source-client",
				run: async () => {
					throw new Error("synthetic-private-password");
				},
			},
			{ label: "fixture", run: () => new Promise(() => {}), timeoutMs: 5 },
			{
				label: "environment",
				run: async () => {
					completed.push("environment");
				},
			},
		]);
		expect(completed).toEqual(["image", "environment"]);
		expect(failedCleanup).toEqual(["source-client", "fixture"]);
		const outcome = finalPerformanceOutcome({
			status: "passed",
			smoke: false,
			checks: { dependencyHealth: !failure.signal.aborted },
			cleanupPassed: failedCleanup.length === 0,
		});
		expect(outcome).toEqual({
			status: "failed",
			acceptanceEligible: false,
			cleanupPassed: false,
		});
		expect(
			JSON.stringify({
				failedCleanup,
				outcome,
				diagnostics: diagnose.mock.calls,
			}),
		).not.toContain("synthetic-private-password");
	});

	it.each([false, true])(
		"handles an actual disconnected pg socket (checked out: %s)",
		async (checkedOut) => {
			let socket: Socket | undefined;
			const server = createServer((connected) => {
				socket = connected;
				connected.on("error", () => {});
				// Minimal PostgreSQL trust handshake; this owns only an ephemeral local socket.
				connected.once("data", () =>
					connected.write(Buffer.from("5200000008000000005a0000000549", "hex")),
				);
			});
			server.listen(0, "127.0.0.1");
			await once(server, "listening");
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("Missing test socket");
			const failure = createPerformanceFailureBoundary(() => {});
			const pool = createFixturePool(
				{
					host: "127.0.0.1",
					port: address.port,
					user: "synthetic",
					database: "synthetic",
					password: "synthetic-private-password",
				},
				"resource-application",
				{ onDependencyError: failure.onDependencyError, poolTimeoutMs: 1000 },
			);
			let client: PoolClient | undefined;
			try {
				client = await pool.connect();
				if (!checkedOut) {
					client.release();
					client = undefined;
				}
				const aborted = once(failure.signal, "abort", {
					signal: AbortSignal.timeout(1000),
				});
				socket?.destroy();
				await aborted;
				expect(failure.signal.aborted).toBe(true);
				expect([...failure.boundaries]).toEqual(["resource-application"]);
			} finally {
				client?.release(true);
				socket?.destroy();
				await closeFixturePool(pool, 1000);
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			}
		},
	);

	it("bounds pool.end independently when a checked-out client cannot be released", async () => {
		const pool = { end: () => new Promise(() => {}) } as unknown as Pool;
		await expect(closeFixturePool(pool, 5)).rejects.toThrow(
			"Fixture pool close deadline exceeded",
		);
	});
});
