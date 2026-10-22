import { Pool, type PoolConfig } from "pg";

/** Static fixture boundaries; dependency diagnostics never receive a pg error or connection. */
export type FixturePoolBoundary =
	| "installation-application-admin"
	| "installation-control-admin"
	| "installation-control-cleanup"
	| "resource-application"
	| "resource-web"
	| "resource-identity"
	| "resource-control";

/** Optional failure observation and SQL bounds for long-running disposable harnesses. */
export type FixturePoolOptions = {
	onDependencyError?: (boundary: FixturePoolBoundary) => void;
	poolTimeoutMs?: number;
};

/** Creates a fixture pool and observes both idle-pool and checked-out-client errors.
 * @param config Existing role/connection configuration, never copied into diagnostics.
 * @param boundary Static identity used by the optional dependency failure callback.
 * @param options Optional callback and positive connection/query/statement deadline.
 * @returns The pool, with observers installed before any client can connect.
 * The callback must not throw. Existing callers without options retain their SQL settings.
 */
export function createFixturePool(
	config: PoolConfig,
	boundary: FixturePoolBoundary,
	options: FixturePoolOptions = {},
) {
	const timeout = options.poolTimeoutMs;
	if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 1))
		throw new Error("Invalid fixture pool timeout");
	const pool = new Pool({
		...config,
		...(timeout === undefined
			? {}
			: {
					connectionTimeoutMillis: Math.min(
						config.connectionTimeoutMillis || timeout,
						timeout,
					),
					query_timeout: timeout,
					statement_timeout: timeout,
				}),
	});
	if (options.onDependencyError) {
		const failed = () => options.onDependencyError?.(boundary);
		pool.on("error", failed);
		pool.on("connect", (client) => client.on("error", failed));
	}
	return pool;
}

/** Ends a disposable pool within a finite deadline, rejecting if clients do not drain.
 * @param pool Fixture pool whose checked-out clients the caller has already released.
 * @param timeoutMs Positive close budget; a timeout never implies successful cleanup.
 * @returns Completion only after pool.end resolves before its deadline.
 * @throws Error on timeout or a pool failure. Underlying queries also need their own bounds.
 */
export async function closeFixturePool(pool: Pool, timeoutMs = 10_000) {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
		throw new Error("Invalid fixture pool close timeout");
	const deadline = performance.now() + timeoutMs;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			pool.end(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Fixture pool close deadline exceeded")),
					timeoutMs,
				);
			}),
		]);
		if (performance.now() >= deadline)
			throw new Error("Fixture pool close deadline exceeded");
	} finally {
		clearTimeout(timer);
	}
}
