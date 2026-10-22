import type { FixturePoolBoundary } from "../../packages/testing/src/pool";

/** Creates a failure signal that aborts requests without emitting raw driver errors.
 * @param diagnose Receives a static pool boundary on its first observed failure; must not throw.
 * @returns An abort signal, a static failure list and a callback for every fixture pool/client.
 * Repeated failures are retained by boundary, while cancellation and diagnostics occur once.
 */
export function createPerformanceFailureBoundary(
	diagnose: (boundary: FixturePoolBoundary) => void,
) {
	const controller = new AbortController();
	const boundaries = new Set<FixturePoolBoundary>();
	return {
		signal: controller.signal,
		boundaries,
		onDependencyError(boundary: FixturePoolBoundary) {
			boundaries.add(boundary);
			if (controller.signal.aborted) return;
			controller.abort(new Error("Performance fixture dependency failed"));
			diagnose(boundary);
		},
	};
}

/** Attempts every cleanup step, including after rejection or a step that never settles.
 * @param steps Static labels, bounded-I/O cleanup callbacks and optional per-step budgets.
 * @returns Static failure labels; an empty list alone means cleanup passed.
 * Timeout limits waiting, not the underlying I/O, which callers must also bound or abort.
 * Raw cleanup errors are intentionally discarded because they can contain credentials.
 */
export async function cleanupPerformanceResources(
	steps: readonly {
		label: string;
		run: () => Promise<unknown>;
		timeoutMs?: number;
	}[],
) {
	const failed: string[] = [];
	for (const { label, run, timeoutMs = 15_000 } of steps) {
		const deadline = performance.now() + timeoutMs;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
				throw new Error("Invalid cleanup deadline");
			await Promise.race([
				Promise.resolve().then(run),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("Cleanup deadline exceeded")),
						timeoutMs,
					);
				}),
			]);
			if (performance.now() >= deadline) failed.push(label);
		} catch {
			failed.push(label);
		} finally {
			clearTimeout(timer);
		}
	}
	return failed;
}
