/** Creates one shared tenant selector for all 50 reference-load clients.
 * @returns A synchronous selector accepting each client's existing PRNG output.
 * The original 80% hot-tenant decision is preserved. Each cold decision advances
 * through tenants 1–99, so every 99 offered cold operations cover all cold tenants.
 * Share one selector across clients; selection does not await or change operation mix.
 */
export function createTenantScheduler() {
	let nextColdTenant = 1;
	return (random: number) => {
		if ((random >>> 0) % 10 < 8) return 0;
		const tenant = nextColdTenant;
		nextColdTenant = (nextColdTenant % 99) + 1;
		return tenant;
	};
}

/** Polls only the usage samples present when this pass starts, in insertion order.
 * @param pending Current earliest outstanding samples, keyed by tenant.
 * @param check Serial sample check; may delete completed samples while clients add
 * new samples. Reinserted and newly added entries are deferred to the next pass.
 * @returns Completion after at most the initial map size checks. Check failures
 * propagate to the Commercial gate; this helper does not retry or remove samples.
 */
export async function pollPendingUsage<T>(
	pending: ReadonlyMap<number, T>,
	check: (tenant: number, sample: T) => Promise<void>,
) {
	for (const [tenant, sample] of [...pending]) await check(tenant, sample);
}
