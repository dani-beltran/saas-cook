import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { withTenantTransaction } from "../tenancy";
import { billingFixture } from "./fixture";
import { createBillingService } from "./service";
import {
	correctProjectUsage,
	rebuildUsage,
	reserveProjectUsage,
	settleProjectUsage,
} from "./usage";
import { acceptStripeWebhook } from "./worker";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const clean of cleanups.splice(0).reverse()) await clean();
});
async function fixture() {
	const f = await billingFixture();
	cleanups.push(f.cleanup);
	return f;
}
describe("Phase 5 real local policy, durable billing and usage", () => {
	it("isolates billing data with restricted roles, denies unrelated members and preserves billing-only content denial", async () => {
		const f = await fixture();
		await f.checkout();
		await expect(f.service.get(f.outsider, f.org)).rejects.toThrow();
		expect(
			(await f.web.query("SELECT * FROM tenancy.billing_accounts")).rows,
		).toEqual([]);
		await withTenantTransaction(
			f.web,
			f.otherOrg,
			[f.outsider.userId],
			false,
			async (c) => {
				expect(
					(
						await c.query(
							"SELECT * FROM tenancy.billing_accounts WHERE organization_id=$1",
							[f.org],
						)
					).rows,
				).toEqual([]);
				await c.query("SAVEPOINT denied_insert");
				await expect(
					c.query(
						"INSERT INTO tenancy.billing_accounts(organization_id,environment) VALUES($1,'test:acct_synthetic')",
						[f.org],
					),
				).rejects.toThrow();
				await c.query("ROLLBACK TO SAVEPOINT denied_insert");
			},
		);
		const user = await f.user(),
			member = await f.member(f.owner, f.org, user);
		await f.tenancy.transitionMembership(f.owner, f.org, {
			membershipId: member,
			role: "billing",
			billable: false,
			status: "active",
			operationKey: randomUUID(),
		});
		await expect(f.service.get(user, f.org)).resolves.toMatchObject({
			enabled: true,
		});
		await expect(
			f.resources.createProject(user, f.org, {
				name: "Denied",
				slug: "denied",
				operationKey: randomUUID(),
			}),
		).rejects.toThrow();
	});
	it("persists scoped commands before calls, deduplicates replay and never grants from checkout", async () => {
		const f = await fixture(),
			input = {
				kind: "checkout" as const,
				selection: { planVersionId: f.plan.id, quantity: 5 },
				locale: "es" as const,
				operationKey: randomUUID(),
			};
		const a = await f.service.command(f.owner, f.org, input);
		expect(f.calls).toEqual([]);
		expect(await f.service.command(f.owner, f.org, input)).toEqual(a);
		await expect(
			f.service.command(f.owner, f.org, {
				...input,
				selection: { ...input.selection, quantity: 6 },
			}),
		).rejects.toThrow();
		await f.worker.processAccount(f.org);
		const snapshot = await f.service.get(f.owner, f.org);
		expect(snapshot.accessState).toBe("free");
		expect(snapshot.commands[0].state).toBe("complete");
		expect(f.calls.filter((v) => v.startsWith("checkout"))).toHaveLength(1);
		await f.worker.processAccount(f.org);
		expect(f.calls.filter((v) => v.startsWith("checkout"))).toHaveLength(1);
	});
	it("converges active, delinquent, renewal, scheduled cancellation and canceled state without replay extending grace", async () => {
		const f = await fixture();
		await f.checkout();
		const s = f.subscription();
		f.setTruth({ subscription: s, invoices: [] });
		await f.worker.processAccount(f.org);
		expect(await f.service.get(f.owner, f.org)).toMatchObject({
			accessState: "active",
			seats: { capacity: 5 },
		});
		s.status = "past_due";
		await f.worker.processAccount(f.org);
		const grace = (await f.service.get(f.owner, f.org)).graceEnd;
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).graceEnd).toBe(grace);
		s.status = "active";
		s.periodEnd = new Date(Date.now() + 50 * 86400000);
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).graceEnd).toBeNull();
		await f.service.command(f.owner, f.org, {
			kind: "cancel",
			operationKey: randomUUID(),
		});
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).cancelAt).not.toBeNull();
		s.status = "canceled";
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).accessState).toBe("canceled");
		await expect(
			f.resources.createProject(f.owner, f.org, {
				name: "Disabled",
				slug: "disabled",
				operationKey: randomUUID(),
			}),
		).rejects.toThrow();
	});
	it("quarantines unknown mappings and replays/out-of-order events by reading provider truth once", async () => {
		const f = await fixture();
		const envelope = (id: string, customerId: string) =>
			Buffer.from(
				JSON.stringify({
					id,
					type: "customer.subscription.updated",
					customerId,
					apiVersion: "synthetic",
					quarantine: null,
				}),
			);
		await acceptStripeWebhook(
			f.web,
			f.provider,
			envelope("evt_unknown", "cus_unknown"),
			"synthetic",
		);
		await f.checkout();
		const s = f.subscription();
		f.setTruth({ subscription: s, invoices: [] });
		for (const id of ["evt_new", "evt_old", "evt_new"])
			await acceptStripeWebhook(
				f.web,
				f.provider,
				envelope(id, "cus_synthetic"),
				"synthetic",
			);
		await f.worker.processAccount(f.org);
		expect(
			(
				await f.app.query(
					"SELECT state FROM foundation.billing_inbox WHERE event_id='evt_unknown'",
				)
			).rows[0].state,
		).toBe("quarantined");
		expect(
			(
				await f.app.query(
					"SELECT count(*) FROM foundation.billing_inbox WHERE state='processed'",
				)
			).rows[0].count,
		).toBe("2");
		const version = (await f.service.get(f.owner, f.org)).sourceVersion;
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).sourceVersion).toBe(version);
	});
	it("records an external downgrade, blocks new seats and releases a deactivated seat exactly once", async () => {
		const f = await fixture(),
			member = await f.user(),
			mid = await f.member(f.owner, f.org, member);
		await f.checkout();
		f.setTruth({ subscription: f.subscription(1), invoices: [] });
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).seats).toEqual({
			capacity: 1,
			occupied: 2,
			overCapacity: true,
		});
		await expect(f.member(f.owner, f.org, await f.user())).rejects.toThrow();
		const input = {
			membershipId: mid,
			role: "member" as const,
			billable: true,
			status: "inactive" as const,
			operationKey: randomUUID(),
		};
		await f.tenancy.transitionMembership(f.owner, f.org, input);
		await f.tenancy.transitionMembership(f.owner, f.org, input);
		expect((await f.service.get(f.owner, f.org)).seats.occupied).toBe(1);
		await expect(
			f.tenancy.setLocalCapacity(f.owner, f.org, 100),
		).rejects.toThrow();
	});
	it("previews upgrades and schedules decreases, rejecting reductions below occupancy", async () => {
		const f = await fixture();
		await f.checkout();
		f.setTruth({ subscription: f.subscription(5), invoices: [] });
		await f.worker.processAccount(f.org);
		const p = await f.service.preview(f.owner, f.org, {
			planVersionId: f.plan.id,
			quantity: 8,
		});
		expect(p.decrease).toBe(false);
		await f.service.command(f.owner, f.org, {
			kind: "change",
			previewId: p.id,
			operationKey: randomUUID(),
		});
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).seats.capacity).toBe(8);
		const d = await f.service.preview(f.owner, f.org, {
			planVersionId: f.plan.id,
			quantity: 3,
		});
		expect(d.decrease).toBe(true);
		await f.service.command(f.owner, f.org, {
			kind: "change",
			previewId: d.id,
			operationKey: randomUUID(),
		});
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).seats.capacity).toBe(8);
		expect((await f.service.get(f.owner, f.org)).scheduled?.quantity).toBe(3);
	});
	it("honors bounded confirmed snapshots during outages and recovers missed changes", async () => {
		const f = await fixture();
		await f.checkout();
		f.setTruth({ subscription: f.subscription(), invoices: [] });
		await f.worker.processAccount(f.org);
		f.setOutage(true);
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).health).toBe("outage");
		await f.resources.createProject(f.owner, f.org, {
			name: "Allowed",
			slug: "allowed",
			operationKey: randomUUID(),
		});
		await f.app.query(
			"UPDATE tenancy.billing_accounts SET valid_until=now()-interval '1 second' WHERE organization_id=$1",
			[f.org],
		);
		await expect(
			f.resources.createProject(f.owner, f.org, {
				name: "Expired",
				slug: "expired",
				operationKey: randomUUID(),
			}),
		).rejects.toThrow();
		f.setOutage(false);
		await f.worker.processAccount(f.org);
		expect((await f.service.get(f.owner, f.org)).health).toBe("healthy");
	});
	it("keeps Foundation quotas effective with billing disabled, including final-unit races and atomic retries", async () => {
		const f = await fixture(),
			local = createBillingService(f.web, f.authorization, {
				origin: "http://localhost:3000",
				defaultProjectCreatesPerMonth: 2,
			});
		const input = { name: "First", slug: "first", operationKey: randomUUID() };
		const first = await f.resources.createProject(f.owner, f.org, input);
		expect((await f.resources.createProject(f.owner, f.org, input)).id).toBe(
			first.id,
		);
		const results = await Promise.allSettled(
			["second", "third"].map((slug) =>
				f.resources.createProject(f.owner, f.org, {
					name: slug,
					slug,
					operationKey: randomUUID(),
				}),
			),
		);
		expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
		const snapshot = await local.get(f.owner, f.org);
		expect(snapshot.enabled).toBe(false);
		expect(snapshot.usage.consumed).toBe(2);
		expect(
			(
				await f.app.query(
					"SELECT count(*) FROM tenancy.usage_events WHERE organization_id=$1",
					[f.org],
				)
			).rows[0].count,
		).toBe("2");
		expect(
			(
				await f.app.query(
					"SELECT count(*) FROM tenancy.billing_notices WHERE organization_id=$1",
					[f.org],
				)
			).rows[0].count,
		).toBe("3");
	});
	it("releases/expirs reservations, appends deduplicated corrections and rebuilds corrupted aggregates", async () => {
		const f = await fixture();
		const tx = <T>(work: Parameters<typeof withTenantTransaction<T>>[4]) =>
			withTenantTransaction(f.web, f.org, [f.owner.userId], true, work);
		const key = randomUUID(),
			id = await tx((c) =>
				reserveProjectUsage(c, f.org, key, 1, { kind: "limited", limit: 2 }),
			);
		await tx((c) => settleProjectUsage(c, f.org, id, "released"));
		await tx((c) => settleProjectUsage(c, f.org, id, "released"));
		await expect(
			tx((c) => reserveProjectUsage(c, f.org, key)),
		).rejects.toThrow();
		const expired = await tx((c) =>
			reserveProjectUsage(c, f.org, randomUUID()),
		);
		await f.app.query(
			"UPDATE tenancy.quota_reservations SET expires_at=now()-interval '1 second' WHERE id=$1",
			[expired],
		);
		await expect(
			tx((c) => settleProjectUsage(c, f.org, expired, "committed")),
		).rejects.toThrow();
		await f.resources.createProject(f.owner, f.org, {
			name: "Counted",
			slug: "counted",
			operationKey: randomUUID(),
		});
		const e = (
			await f.app.query(
				"SELECT * FROM tenancy.usage_events WHERE organization_id=$1",
				[f.org],
			)
		).rows[0];
		const correction = {
			originalId: e.id,
			operationKey: randomUUID(),
			quantity: -1,
			reason: "test.adjustment",
		};
		const correctionId = await tx((c) =>
			correctProjectUsage(c, f.org, f.owner.userId, correction),
		);
		expect(
			await tx((c) =>
				correctProjectUsage(c, f.org, f.owner.userId, correction),
			),
		).toBe(correctionId);
		await expect(
			tx((c) =>
				correctProjectUsage(c, f.org, f.owner.userId, {
					...correction,
					operationKey: randomUUID(),
				}),
			),
		).rejects.toThrow();
		await f.app.query(
			"UPDATE tenancy.quota_buckets SET consumed=99 WHERE id=$1",
			[e.bucket_id],
		);
		await tx((c) => rebuildUsage(c, f.org, e.bucket_id));
		expect((await f.service.get(f.owner, f.org)).usage.consumed).toBe(0);
		await expect(
			f.web.query("UPDATE tenancy.usage_events SET quantity=99 WHERE id=$1", [
				e.id,
			]),
		).rejects.toThrow();
	});
});

it("reconciles an ambiguous successful checkout without a second semantic subscription and fences aged retries", async () => {
	const f = await fixture();
	f.setAmbiguous(true);
	const command = await f.checkout();
	expect(f.calls.filter((v) => v.startsWith("checkout"))).toHaveLength(1);
	await f.app.query(
		"UPDATE tenancy.billing_commands SET available_at=now(),authorized_until=now()-interval '1 second' WHERE id=$1",
		[command.id],
	);
	await f.worker.processAccount(f.org);
	expect((await f.service.get(f.owner, f.org)).commands[0].state).toBe(
		"complete",
	);
	expect(f.calls.filter((v) => v.startsWith("checkout"))).toHaveLength(1);
	expect((await f.service.get(f.owner, f.org)).seats.capacity).toBe(5);
});
it("refuses retries beyond the provider key horizon", async () => {
	const f = await fixture();
	const command = await f.service.command(f.owner, f.org, {
		kind: "checkout",
		selection: { planVersionId: f.plan.id, quantity: 5 },
		locale: "en",
		operationKey: randomUUID(),
	});
	await f.app.query(
		"UPDATE tenancy.billing_commands SET state='submitted',first_attempt_at=now()-interval '21 hours' WHERE id=$1",
		[command.id],
	);
	await f.worker.processAccount(f.org);
	expect((await f.service.get(f.owner, f.org)).commands[0].state).toBe(
		"review",
	);
	expect(f.calls).toHaveLength(0);
});
it("opens the payment portal while an older command awaits reconciliation", async () => {
	const f = await fixture();
	const checkout = await f.checkout();
	f.setTruth({ subscription: f.subscription(6), invoices: [] });
	await f.app.query(
		"UPDATE tenancy.billing_commands SET state='review',first_attempt_at=now()-interval '21 hours',available_at=now() WHERE id=$1",
		[checkout.id],
	);
	let portalCalls = 0;
	const portal = f.provider.portal;
	f.provider.portal = async (input) => {
		portalCalls++;
		return portal(input);
	};
	const command = await f.service.command(f.owner, f.org, {
		kind: "portal",
		operationKey: randomUUID(),
	});
	await f.worker.tick();
	const commands = (await f.service.get(f.owner, f.org)).commands;
	expect(commands.find((c) => c.id === command.id)).toMatchObject({
		state: "complete",
		url: "https://billing.stripe.com/p/session/synthetic",
	});
	expect(commands.find((c) => c.id === checkout.id)?.state).toBe("review");
	expect(portalCalls).toBe(1);
	expect(f.calls.filter((call) => call.startsWith("checkout:"))).toHaveLength(
		1,
	);
	// Review remains reconciliation-only and can still complete from provider truth.
	f.setTruth({ subscription: f.subscription(5), invoices: [] });
	await f.worker.processAccount(f.org);
	expect(
		(await f.service.get(f.owner, f.org)).commands.find(
			(c) => c.id === checkout.id,
		)?.state,
	).toBe("complete");
	expect(portalCalls).toBe(1);
	expect(f.calls.filter((call) => call.startsWith("checkout:"))).toHaveLength(
		1,
	);
});
it("rotates expired first checkouts out of the bounded work batch", async () => {
	const f = await fixture();
	const abandoned = [f.org];
	for (let i = 1; i < 10; i++)
		abandoned.push((await f.organization(f.owner)).id);
	for (const org of abandoned) {
		const command = await f.service.command(f.owner, org, {
			kind: "checkout",
			selection: { planVersionId: f.plan.id, quantity: 5 },
			locale: "en",
			operationKey: randomUUID(),
		});
		await f.app.query(
			"UPDATE tenancy.billing_commands SET authorized_until=now()-interval '1 second' WHERE id=$1",
			[command.id],
		);
	}
	await f.app.query(
		"UPDATE tenancy.billing_accounts SET next_reconcile_at=now()-interval '1 hour' WHERE organization_id=ANY($1::uuid[])",
		[abandoned],
	);
	const active = (await f.organization(f.owner)).id;
	const command = await f.service.command(f.owner, active, {
		kind: "checkout",
		selection: { planVersionId: f.plan.id, quantity: 5 },
		locale: "en",
		operationKey: randomUUID(),
	});
	await f.worker.tick();
	expect(f.calls).toHaveLength(0);
	await f.worker.tick();
	expect((await f.service.get(f.owner, active)).commands[0]).toMatchObject({
		id: command.id,
		state: "complete",
	});
	expect(f.calls.filter((call) => call.startsWith("checkout:"))).toHaveLength(
		1,
	);
	const idle = await f.app.query(
		"SELECT customer_id,next_reconcile_at>clock_timestamp() AS deferred FROM tenancy.billing_accounts WHERE organization_id=ANY($1::uuid[])",
		[abandoned],
	);
	expect(idle.rows).toHaveLength(10);
	for (const row of idle.rows)
		expect(row).toEqual({ customer_id: null, deferred: true });
});
it("shows current local quotas before another reservation refreshes the bucket", async () => {
	const f = await fixture();
	const tx = <T>(work: Parameters<typeof withTenantTransaction<T>>[4]) =>
		withTenantTransaction(f.web, f.org, [f.owner.userId], true, work);
	await tx(async (c) => {
		const id = await reserveProjectUsage(c, f.org, randomUUID(), 1, {
			kind: "limited",
			limit: 2,
		});
		await settleProjectUsage(c, f.org, id, "committed");
	});
	for (const limit of [0, 10, null]) {
		const service = createBillingService(f.web, f.authorization, {
			origin: "http://localhost:3000",
			defaultProjectCreatesPerMonth: limit,
		});
		expect((await service.get(f.owner, f.org)).usage).toMatchObject({
			consumed: 1,
			reserved: 0,
			policy:
				limit === null ? { kind: "unlimited" } : { kind: "limited", limit },
		});
	}
	await tx(async (c) => {
		const id = await reserveProjectUsage(c, f.org, randomUUID(), 2, {
			kind: "limited",
			limit: 10,
		});
		await settleProjectUsage(c, f.org, id, "committed");
	});
	expect((await f.service.get(f.owner, f.org)).usage.consumed).toBe(3);
});
it("shows a confirmed plan quota increase before new usage and retains local restrictions", async () => {
	const f = await fixture();
	await f.checkout();
	f.setTruth({ subscription: f.subscription(), invoices: [] });
	await f.worker.processAccount(f.org);
	const service = createBillingService(f.web, f.authorization, {
		provider: f.provider,
		origin: "http://localhost:3000",
		defaultProjectCreatesPerMonth: 10,
	});
	await withTenantTransaction(
		f.web,
		f.org,
		[f.owner.userId],
		true,
		async (c) => {
			const id = await reserveProjectUsage(c, f.org, randomUUID(), 1, {
				kind: "limited",
				limit: 10,
			});
			await settleProjectUsage(c, f.org, id, "committed");
		},
	);
	const upgraded = {
		...f.plan,
		id: "team/v2",
		version: 2,
		features: {
			...f.plan.features,
			projectCreates: { kind: "limited", limit: 5 },
		},
	};
	await f.app.query(
		"INSERT INTO foundation.plan_versions(id,plan_key,version,definition) VALUES($1,$2,$3,$4)",
		[upgraded.id, upgraded.key, upgraded.version, JSON.stringify(upgraded)],
	);
	await f.app.query(
		"INSERT INTO foundation.billing_prices(environment,price_id,plan_version_id,currency,amount,interval) VALUES($1,'price_upgraded',$2,'eur',1000,'month')",
		[f.provider.environment, upgraded.id],
	);
	expect((await service.get(f.owner, f.org)).usage.policy).toEqual({
		kind: "limited",
		limit: 2,
	});
	const subscription = f.subscription();
	subscription.price = { ...subscription.price, id: "price_upgraded" };
	f.setTruth({ subscription, invoices: [] });
	await f.worker.processAccount(f.org);
	expect((await service.get(f.owner, f.org)).usage).toMatchObject({
		consumed: 1,
		reserved: 0,
		policy: { kind: "limited", limit: 5 },
	});
	// The same purchased grant remains bounded by a stricter local policy.
	const restricted = createBillingService(f.web, f.authorization, {
		provider: f.provider,
		origin: "http://localhost:3000",
		defaultProjectCreatesPerMonth: 3,
	});
	expect((await restricted.get(f.owner, f.org)).usage.policy).toEqual({
		kind: "limited",
		limit: 3,
	});
});
it("retains immutable sold versions, handles trial and unpaid policy, and rejects mismatched provider prices", async () => {
	const f = await fixture();
	await f.checkout();
	const s = f.subscription(5, "trialing");
	s.trialEnd = new Date(Date.now() + 86400000);
	f.setTruth({ subscription: s, invoices: [] });
	await f.worker.processAccount(f.org);
	expect((await f.service.get(f.owner, f.org)).accessState).toBe("trial");
	await expect(
		f.app.query(
			"UPDATE foundation.plan_versions SET definition='{}' WHERE id=$1",
			[f.plan.id],
		),
	).rejects.toThrow();
	await f.app.query(
		"INSERT INTO foundation.plan_versions(id,plan_key,version,definition) VALUES('team/v2','team',2,$1)",
		[JSON.stringify({ ...f.plan, id: "team/v2", version: 2 })],
	);
	await f.worker.processAccount(f.org);
	expect((await f.service.get(f.owner, f.org)).planVersionId).toBe("team/v1");
	s.status = "unpaid";
	await f.worker.processAccount(f.org);
	await expect(
		f.resources.createProject(f.owner, f.org, {
			name: "No paid grant",
			slug: "no-paid-grant",
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	s.price.amount = 2000;
	await f.worker.processAccount(f.org);
	expect((await f.service.get(f.owner, f.org)).health).toBe("review");
});
it("reconciles expired membership occupancy and preserves repeated cleanup; scheduled decreases fence admission", async () => {
	const f = await fixture(),
		user = await f.user(),
		member = await f.member(f.owner, f.org, user);
	await f.checkout();
	f.setTruth({ subscription: f.subscription(5), invoices: [] });
	await f.worker.processAccount(f.org);
	await f.app.query(
		"UPDATE tenancy.memberships SET expires_at=now()-interval '1 second' WHERE id=$1",
		[member],
	);
	await f.worker.processAccount(f.org);
	expect((await f.service.get(f.owner, f.org)).seats.occupied).toBe(1);
	const input = {
		membershipId: member,
		role: "member" as const,
		status: "inactive" as const,
		billable: true,
		operationKey: randomUUID(),
	};
	await f.tenancy.transitionMembership(f.owner, f.org, input);
	await f.tenancy.transitionMembership(f.owner, f.org, input);
	expect((await f.service.get(f.owner, f.org)).seats.occupied).toBe(1);
	const p = await f.service.preview(f.owner, f.org, {
		planVersionId: f.plan.id,
		quantity: 1,
	});
	await f.service.command(f.owner, f.org, {
		kind: "change",
		previewId: p.id,
		operationKey: randomUUID(),
	});
	await expect(f.member(f.owner, f.org, await f.user())).rejects.toThrow();
	await f.worker.processAccount(f.org);
	expect((await f.service.get(f.owner, f.org)).seats.capacity).toBe(5);
	await expect(f.member(f.owner, f.org, await f.user())).rejects.toThrow();
});
it("retains operation deduplication across a period boundary and checks transaction-wide snapshot expiry", async () => {
	const f = await fixture();
	const tx = <T>(fn: Parameters<typeof withTenantTransaction<T>>[4]) =>
		withTenantTransaction(f.web, f.org, [f.owner.userId], true, fn);
	const key = randomUUID(),
		id = await tx((c) => reserveProjectUsage(c, f.org, key));
	await tx((c) => settleProjectUsage(c, f.org, id, "committed"));
	await f.app.query(
		"UPDATE tenancy.quota_buckets SET period_start=period_start-interval '1 month',period_end=period_end-interval '1 month' WHERE organization_id=$1",
		[f.org],
	);
	expect(await tx((c) => reserveProjectUsage(c, f.org, key))).toBe(id);
	expect(
		(
			await f.app.query(
				"SELECT count(*) FROM tenancy.usage_events WHERE organization_id=$1",
				[f.org],
			)
		).rows[0].count,
	).toBe("1");
	await expect(
		tx(async (c) => {
			await c.query(
				"SELECT set_config('app.authorization_expires_at',(clock_timestamp()+interval '50 milliseconds')::text,true)",
			);
			await c.query("SELECT pg_sleep(0.1)");
		}),
	).rejects.toThrow();
});

it("rechecks a queued billing manager after revocation before issuing provider writes", async () => {
	const f = await fixture(),
		manager = await f.user(),
		id = await f.member(f.owner, f.org, manager);
	await f.tenancy.transitionMembership(f.owner, f.org, {
		membershipId: id,
		role: "billing",
		status: "active",
		billable: false,
		operationKey: randomUUID(),
	});
	const command = await f.service.command(manager, f.org, {
		kind: "checkout",
		selection: { planVersionId: f.plan.id, quantity: 5 },
		locale: "en",
		operationKey: randomUUID(),
	});
	await f.tenancy.transitionMembership(f.owner, f.org, {
		membershipId: id,
		role: "billing",
		status: "inactive",
		billable: false,
		operationKey: randomUUID(),
	});
	await f.worker.processAccount(f.org);
	expect(f.calls).toHaveLength(0);
	expect(
		(await f.service.get(f.owner, f.org)).commands.find(
			(c) => c.id === command.id,
		)?.state,
	).toBe("failed");
});
it("converges concurrent external downgrade and admission while preserving existing members", async () => {
	const f = await fixture();
	await f.checkout();
	f.setTruth({ subscription: f.subscription(5), invoices: [] });
	await f.worker.processAccount(f.org);
	f.setTruth({ subscription: f.subscription(1), invoices: [] });
	const newcomer = await f.user();
	await Promise.allSettled([
		f.member(f.owner, f.org, newcomer),
		f.worker.processAccount(f.org),
	]);
	await f.worker.processAccount(f.org);
	const snapshot = await f.service.get(f.owner, f.org);
	expect(snapshot.seats.capacity).toBe(1);
	const actual = await f.app.query(
		"SELECT count(*)::int AS count FROM tenancy.memberships WHERE organization_id=$1 AND seat_counted",
		[f.org],
	);
	expect(snapshot.seats.occupied).toBe(actual.rows[0].count);
	await expect(f.member(f.owner, f.org, await f.user())).rejects.toThrow();
});

it("abandons a late provider result after worker connection loss, retaining the inbox for restart", async () => {
	const f = await fixture();
	await f.checkout();
	f.setTruth({ subscription: f.subscription(5), invoices: [] });
	await f.worker.processAccount(f.org);
	const before = await f.service.get(f.owner, f.org);
	await acceptStripeWebhook(
		f.web,
		f.provider,
		Buffer.from(
			JSON.stringify({
				id: "evt_worker_crash",
				type: "customer.subscription.updated",
				customerId: "cus_synthetic",
				apiVersion: "synthetic",
			}),
		),
		"signed-fixture",
	);
	f.setTruth({ subscription: f.subscription(6), invoices: [] });
	let resume!: () => void, started!: () => void;
	const gate = new Promise<void>((resolve) => {
			resume = resolve;
		}),
		entered = new Promise<void>((resolve) => {
			started = resolve;
		});
	const truth = f.provider.truth;
	f.provider.truth = async (customer) => {
		const result = await truth(customer);
		started();
		await gate;
		return result;
	};
	const processing = f.worker.processAccount(f.org);
	await entered;
	const pid = (
		await f.app.query(
			"SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename='saas_cook_worker'",
		)
	).rows[0].pid;
	const admin = new Pool({
		connectionString:
			process.env.TEST_DATABASE_ADMIN_URL ??
			"postgres://postgres:local_phase1@127.0.0.1:55433/postgres",
	});
	try {
		await admin.query("SELECT pg_terminate_backend($1)", [pid]);
	} finally {
		await admin.end();
		resume();
	}
	await processing;
	expect((await f.service.get(f.owner, f.org)).sourceVersion).toBe(
		before.sourceVersion,
	);
	expect(
		(
			await f.app.query(
				"SELECT state FROM foundation.billing_inbox WHERE event_id='evt_worker_crash'",
			)
		).rows[0].state,
	).toBe("pending");
	f.provider.truth = truth;
	await f.worker.processAccount(f.org);
	expect((await f.service.get(f.owner, f.org)).seats.capacity).toBe(6);
	expect(
		(
			await f.app.query(
				"SELECT state FROM foundation.billing_inbox WHERE event_id='evt_worker_crash'",
			)
		).rows[0].state,
	).toBe("processed");
});
