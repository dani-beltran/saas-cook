import { describe, expect, it } from "vitest";
import {
	createTenantScheduler,
	pollPendingUsage,
} from "./performance-scheduling";

describe("reference workload scheduling", () => {
	it("offers work to all 99 cold tenants without changing the hot decision", () => {
		const chooseTenant = createTenantScheduler();
		const cold: number[] = [];
		let hot = 0;
		// These decisions can be interleaved by any of the 50 concurrent clients.
		for (let decision = 0; decision < 990; decision++) {
			const random = decision % 10;
			const tenant = chooseTenant(random);
			expect(tenant === 0).toBe((random >>> 0) % 10 < 8);
			if (tenant === 0) hot++;
			else cold.push(tenant);
		}
		expect(hot).toBe(792);
		const everyColdTenant = Array.from({ length: 99 }, (_, i) => i + 1);
		expect(cold.slice(0, 99)).toEqual(everyColdTenant);
		expect(cold.slice(99)).toEqual(everyColdTenant);
	});

	it("preserves unsigned hot selection for each client's signed PRNG output", () => {
		const chooseTenant = createTenantScheduler();
		const random = Array.from({ length: 50 }, (_, i) => i + 1701);
		for (let turn = 0; turn < 50; turn++)
			for (let client = 0; client < 50; client++) {
				random[client] ^= random[client] << 13;
				random[client] ^= random[client] >>> 17;
				random[client] ^= random[client] << 5;
				expect(chooseTenant(random[client]) === 0).toBe(
					(random[client] >>> 0) % 10 < 8,
				);
			}
	});

	it("defers reinserted and new samples so one poll cannot starve bulk checks", async () => {
		const pending = new Map([
			[1, "first"],
			[2, "second"],
		]);
		const checked: [number, string][] = [];
		await pollPendingUsage(pending, async (tenant, sample) => {
			checked.push([tenant, sample]);
			pending.delete(tenant);
			await Promise.resolve();
			// Model another client completing a create while polling awaits HTTP.
			pending.set(tenant, `${sample}-next`);
			pending.set(3, "new-tenant");
			if (checked.length > 2) throw new Error("Unbounded usage poll");
		});
		expect(checked).toEqual([
			[1, "first"],
			[2, "second"],
		]);
		expect(pending.size).toBe(3);
		const nextPass: [number, string][] = [];
		await pollPendingUsage(pending, async (tenant, sample) => {
			nextPass.push([tenant, sample]);
			pending.delete(tenant);
		});
		expect(nextPass).toEqual([
			[1, "first-next"],
			[3, "new-tenant"],
			[2, "second-next"],
		]);
		expect(pending.size).toBe(0);
	});

	it("propagates a failed sample check without dropping pending evidence", async () => {
		const pending = new Map([[1, "unobserved"]]);
		await expect(
			pollPendingUsage(pending, async () => {
				throw new Error("Usage deadline exceeded");
			}),
		).rejects.toThrow("Usage deadline exceeded");
		expect(pending.get(1)).toBe("unobserved");
	});
});
