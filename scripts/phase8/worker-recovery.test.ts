import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cleanupRecoveryResources,
	registerRecoveryContainer,
	waitForRecovery,
	withinRecoveryDeadline,
} from "./worker-recovery";

vi.mock("node:timers/promises", () => ({
	setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("recovery observation deadlines", () => {
	it("rejects a hung observation instead of waiting forever", async () => {
		vi.useFakeTimers();
		const result = waitForRecovery(
			() => new Promise<boolean>(() => {}),
			"Hung observation",
			100,
		);
		const rejected = expect(result).rejects.toThrow(
			"recovery deadline exceeded",
		);
		await vi.advanceTimersByTimeAsync(100);
		await rejected;
		expect(vi.getTimerCount()).toBe(0);
	});
	it("rejects a successful result delivered after the elapsed deadline", async () => {
		// Simulate event-loop blockage: the promise resolves before the timer callback,
		// but monotonic elapsed time has already crossed the acceptance budget.
		const now = vi.spyOn(performance, "now").mockReturnValue(0);
		await expect(
			waitForRecovery(
				async () => {
					now.mockReturnValue(101);
					return true;
				},
				"Late success",
				100,
			),
		).rejects.toThrow("recovery deadline exceeded");
	});
	it("uses one budget across false checks and polling delays", async () => {
		vi.useFakeTimers();
		const check = vi.fn(async () => false);
		const rejected = expect(
			waitForRecovery(check, "Never ready", 60),
		).rejects.toThrow("recovery deadline exceeded");
		await vi.advanceTimersByTimeAsync(60);
		await rejected;
		expect(check).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("returns a timely result and clears its deadline timer", async () => {
		vi.useFakeTimers();
		await expect(
			withinRecoveryDeadline(async () => "ready", 100, "Ready"),
		).resolves.toBe("ready");
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("recovery cleanup", () => {
	it("attempts every remaining resource after failures and a hung cleanup", async () => {
		vi.useFakeTimers();
		const completed: string[] = [];
		const result = cleanupRecoveryResources([
			{
				label: "Rejected removal",
				run: async () => {
					throw new Error("Removal failed");
				},
			},
			{
				label: "Hung removal",
				run: () => new Promise(() => {}),
				timeoutMs: 100,
			},
			{
				label: "Remaining removal",
				run: async () => completed.push("removed"),
			},
		]);
		const rejected = expect(result).rejects.toMatchObject({
			name: "AggregateError",
			errors: [expect.any(Error), expect.any(Error)],
		});
		await vi.advanceTimersByTimeAsync(100);
		await rejected;
		expect(completed).toEqual(["removed"]);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("retains a container name when startup creates it then fails before stdout", async () => {
		const containers = new Set<string>();
		let createdName = "";
		await expect(
			registerRecoveryContainer(containers, async (name) => {
				createdName = name;
				expect(containers.has(name)).toBe(true);
				throw new Error("Docker response lost after creation");
			}),
		).rejects.toThrow("Docker response lost after creation");
		expect([...containers]).toEqual([createdName]);
		const removed: string[] = [];
		await cleanupRecoveryResources(
			[...containers].map((name) => ({
				label: "Tracked container removal",
				run: async () => {
					removed.push(name);
					containers.delete(name);
				},
			})),
		);
		expect(removed).toEqual([createdName]);
		expect(containers.size).toBe(0);
	});
});
