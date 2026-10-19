import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import { afterEach, expect, it } from "vitest";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: Evaluator-owned, outside cached application tasks.
const candidate = process.env.PHASE4_CANDIDATE_ROOT;
if (!candidate) throw new Error("A disposable candidate is required");
const load = (file: string) =>
	import(pathToFileURL(path.join(candidate, file)).href);
const { billingFixture } = await load("packages/db/src/billing/fixture.ts");
const { withTenantTransaction } = await load("packages/db/src/tenancy.ts");
const usage = await load("packages/db/src/billing/usage.ts");
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
	const f = await billingFixture();
	cleanups.push(f.cleanup);
	return f;
}
const tx = <T>(
	f: Awaited<ReturnType<typeof billingFixture>>,
	fn: (c: PoolClient) => Promise<T>,
): Promise<T> =>
	withTenantTransaction(f.web, f.org, [f.owner.userId], true, fn);

it("phase5-task-01 immutable-v2", async () => {
	const f = await fixture();
	const { teamV2Plan, installTeamV2 } = await load(
		"packages/db/src/billing/team-v2.ts",
	);
	const { selectedPlan } = await load("packages/db/src/billing/service.ts");
	const { installBillingCatalogue } = await load(
		"packages/db/src/billing/catalogue.ts",
	);
	await f.checkout();
	f.setTruth({ subscription: f.subscription(), invoices: [] });
	await f.worker.processAccount(f.org);
	expect((await f.service.get(f.owner, f.org)).planVersionId).toBe("team/v1");
	const before = (
		await f.app.query(
			"SELECT definition FROM foundation.plan_versions WHERE id='team/v1'",
		)
	).rows[0].definition;
	expect(teamV2Plan).toMatchObject({
		id: "team/v2",
		key: "team",
		version: 2,
		name: "Team",
		mode: "seat",
		trialDays: 0,
		features: {
			projects: { kind: "limited", limit: 50 },
			projectCreates: { kind: "limited", limit: 10 },
			seats: 1,
		},
		graceHours: 24,
		snapshotHours: 24,
	});
	const input = { environment: "test:acct_synthetic", priceId: "price_next" };
	await installTeamV2(f.app, input);
	await installTeamV2(f.app, input);
	expect(await f.service.get(f.owner, f.org)).toMatchObject({
		planVersionId: "team/v1",
		usage: { policy: { kind: "limited", limit: 2 } },
	});
	await installBillingCatalogue(f.app, {
		environment: "live:acct_other",
		plans: [
			{
				plan: f.plan,
				price: {
					id: "price_next",
					currency: "eur",
					amount: 1000,
					interval: "month",
				},
			},
		],
	});
	expect(
		(
			await f.app.query(
				"SELECT definition FROM foundation.plan_versions WHERE id='team/v1'",
			)
		).rows[0].definition,
	).toEqual(before);
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM foundation.plan_versions WHERE id='team/v2'",
			)
		).rows[0].n,
	).toBe(1);
	const c = await f.app.connect();
	try {
		expect(
			(await selectedPlan(c, "test:acct_synthetic", "team/v2")).price_id,
		).toBe("price_next");
		expect((await selectedPlan(c, "live:acct_other", "team/v1")).price_id).toBe(
			"price_next",
		);
		await expect(
			selectedPlan(c, "live:acct_other", "team/v2"),
		).rejects.toThrow();
		await expect(
			selectedPlan(c, "live:acct_synthetic", "team/v2"),
		).rejects.toThrow();
	} finally {
		c.release();
	}
	await expect(installTeamV2(f.web, input)).rejects.toThrow();
	await expect(
		installTeamV2(f.app, { ...input, admin: true }),
	).rejects.toThrow();
	await expect(
		installTeamV2(f.app, { ...input, environment: "invalid" }),
	).rejects.toThrow();
	await expect(
		installTeamV2(f.app, { ...input, priceId: "price_synthetic" }),
	).rejects.toThrow();
	await expect(f.service.get(f.outsider, f.org)).rejects.toThrow();
	expect(
		(await f.web.query("SELECT * FROM tenancy.billing_accounts")).rows,
	).toEqual([]);
	expect(
		await readFile(path.join(candidate, "CUSTOM-BILLING-NOTES.md"), "utf8"),
	).toBe("Preserve this billing product note.\n");
});

it("phase5-task-02 template-authorization-replay-race", async () => {
	const f = await fixture();
	const { createProjectTemplateService } = await load(
		"packages/db/src/project-templates.ts",
	);
	const templates = createProjectTemplateService(f.resources);
	const input = {
		template: "kanban",
		name: "Held out Kanban",
		slug: `held-${randomUUID()}`,
		operationKey: randomUUID(),
	};
	const project = await templates.create(f.owner, f.org, input);
	expect(project.description).toBe("Kanban board");
	expect((await templates.create(f.owner, f.org, input)).id).toBe(project.id);
	await expect(
		templates.create(f.owner, f.org, { ...input, template: "roadmap" }),
	).rejects.toThrow();
	await expect(
		templates.create(f.owner, f.org, {
			...input,
			template: "unknown",
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	await expect(
		templates.create(f.owner, f.org, {
			...input,
			providerPaid: true,
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	await expect(
		templates.create(f.outsider, f.org, {
			...input,
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	await expect(
		templates.create(f.owner, f.otherOrg, {
			...input,
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	const race = await Promise.allSettled(
		[1, 2].map((i) =>
			templates.create(f.owner, f.org, {
				template: "roadmap",
				name: `Racer ${i}`,
				slug: `racer-${randomUUID()}`,
				operationKey: randomUUID(),
			}),
		),
	);
	expect(race.filter((v) => v.status === "fulfilled")).toHaveLength(1);
	expect(race.filter((v) => v.status === "rejected")).toHaveLength(1);
	const state = (
		await f.app.query(
			"SELECT sum(consumed)::int AS consumed,sum(reserved)::int AS reserved FROM tenancy.quota_buckets WHERE organization_id=$1",
			[f.org],
		)
	).rows[0];
	expect(state).toEqual({ consumed: 2, reserved: 0 });
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.usage_events WHERE organization_id=$1 AND correction_of IS NULL",
				[f.org],
			)
		).rows[0].n,
	).toBe(2);
	expect(Object.keys(project)).not.toContain("customer_id");
});

it("phase5-task-02 accounting-rollback-expiry-correction-rebuild-window", async () => {
	const f = await fixture();
	const rolled = randomUUID();
	await expect(
		tx(f, async (c) => {
			await usage.reserveProjectUsage(c, f.org, rolled);
			throw new Error("business rollback");
		}),
	).rejects.toThrow("business rollback");
	expect(
		(
			await f.app.query(
				"SELECT id FROM tenancy.quota_reservations WHERE organization_id=$1 AND operation_key=$2",
				[f.org, rolled],
			)
		).rows,
	).toEqual([]);
	const released = await tx(f, (c) =>
		usage.reserveProjectUsage(c, f.org, randomUUID()),
	);
	await tx(f, (c) => usage.settleProjectUsage(c, f.org, released, "released"));
	await tx(f, (c) => usage.settleProjectUsage(c, f.org, released, "released"));
	expect(
		(
			await f.app.query("SELECT id FROM tenancy.usage_events WHERE id=$1", [
				released,
			])
		).rows,
	).toEqual([]);
	const expired = await tx(f, (c) =>
		usage.reserveProjectUsage(c, f.org, randomUUID()),
	);
	await f.app.query(
		"UPDATE tenancy.quota_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
		[expired],
	);
	await expect(
		tx(f, (c) => usage.settleProjectUsage(c, f.org, expired, "committed")),
	).rejects.toThrow();
	const key = randomUUID();
	const id = await tx(f, (c) => usage.reserveProjectUsage(c, f.org, key));
	await tx(f, (c) => usage.settleProjectUsage(c, f.org, id, "committed"));
	const original = (
		await f.app.query("SELECT * FROM tenancy.usage_events WHERE id=$1", [id])
	).rows[0];
	const correction = {
		originalId: id,
		operationKey: randomUUID(),
		quantity: -1,
		reason: "evaluation.correction",
	};
	const adjustment = await tx(f, (c) =>
		usage.correctProjectUsage(c, f.org, f.owner.userId, correction),
	);
	expect(
		await tx(f, (c) =>
			usage.correctProjectUsage(c, f.org, f.owner.userId, correction),
		),
	).toBe(adjustment);
	await expect(
		tx(f, (c) =>
			usage.correctProjectUsage(c, f.org, f.owner.userId, {
				...correction,
				quantity: -2,
			}),
		),
	).rejects.toThrow();
	await f.app.query(
		"UPDATE tenancy.quota_buckets SET consumed=42,reserved=12 WHERE id=$1",
		[original.bucket_id],
	);
	await tx(f, (c) => usage.rebuildUsage(c, f.org, original.bucket_id));
	const rebuilt = (
		await f.app.query(
			"SELECT consumed,reserved FROM tenancy.quota_buckets WHERE id=$1",
			[original.bucket_id],
		)
	).rows[0];
	expect(rebuilt).toEqual({ consumed: 0, reserved: 0 });
	expect(
		(
			await f.app.query(
				"SELECT quantity,occurred_at FROM tenancy.usage_events WHERE id=$1",
				[id],
			)
		).rows[0],
	).toEqual({ quantity: 1, occurred_at: original.occurred_at });
	await f.app.query(
		"UPDATE tenancy.quota_buckets SET period_start=period_start-interval '1 month',period_end=period_end-interval '1 month' WHERE organization_id=$1",
		[f.org],
	);
	expect(await tx(f, (c) => usage.reserveProjectUsage(c, f.org, key))).toBe(id);
	const next = await tx(f, (c) =>
		usage.reserveProjectUsage(c, f.org, randomUUID()),
	);
	await tx(f, (c) => usage.settleProjectUsage(c, f.org, next, "committed"));
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.quota_buckets WHERE organization_id=$1",
				[f.org],
			)
		).rows[0].n,
	).toBe(2);
	expect(usage.monthWindow(new Date("2026-12-31T23:59:59.999Z"))).toEqual({
		start: new Date("2026-12-01T00:00:00.000Z"),
		end: new Date("2027-01-01T00:00:00.000Z"),
	});
	await expect(
		tx(f, async (c) => {
			await c.query(
				"SELECT set_config('app.authorization_expires_at',(clock_timestamp()+interval '20 milliseconds')::text,true)",
			);
			await c.query("SELECT pg_sleep(0.05)");
		}),
	).rejects.toThrow();
});

it("phase5-task-03 current-seat-authority-and-downgrade", async () => {
	const f = await fixture();
	const { createMemberSeatService } = await load(
		"packages/db/src/billing/member-seats.ts",
	);
	const seats = createMemberSeatService(f.tenancy),
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
	const input = { membershipId: mid, operationKey: randomUUID() };
	await expect(seats.deactivate(f.outsider, f.org, input)).rejects.toThrow();
	await expect(seats.deactivate(f.owner, f.otherOrg, input)).rejects.toThrow();
	await expect(
		seats.deactivate(f.owner, f.org, { ...input, capacity: 100 }),
	).rejects.toThrow();
	await seats.deactivate(f.owner, f.org, input);
	await seats.deactivate(f.owner, f.org, input);
	expect((await f.service.get(f.owner, f.org)).seats).toEqual({
		capacity: 1,
		occupied: 1,
		overCapacity: false,
	});
	await expect(
		f.tenancy.transitionMembership(f.owner, f.org, {
			...input,
			operationKey: randomUUID(),
			role: "member",
			billable: true,
			status: "active",
		}),
	).rejects.toThrow();
	await expect(
		f.tenancy.setLocalCapacity(f.owner, f.org, 100),
	).rejects.toThrow();
	const ownerMembership = (
		await f.app.query(
			"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2",
			[f.org, f.owner.userId],
		)
	).rows[0].id;
	await expect(
		seats.deactivate(f.owner, f.org, {
			membershipId: ownerMembership,
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	const manager = await f.user();
	// A local Foundation organization supplies capacity for current-authority checks.
	const freeOrg = (await f.organization(f.owner)).id,
		managerId = await f.member(f.owner, freeOrg, manager),
		target = await f.member(f.owner, freeOrg, await f.user());
	await f.tenancy.transitionMembership(f.owner, freeOrg, {
		membershipId: managerId,
		operationKey: randomUUID(),
		role: "admin",
		billable: true,
		status: "active",
	});
	await f.tenancy.transitionMembership(f.owner, freeOrg, {
		membershipId: managerId,
		operationKey: randomUUID(),
		role: "member",
		billable: true,
		status: "inactive",
	});
	await expect(
		seats.deactivate(manager, freeOrg, {
			membershipId: target,
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
});

it("phase5-task-04 localized-threshold-email", async () => {
	const { renderBillingEmail } = await load("packages/email/src/billing.tsx");
	for (const [locale, copy] of [
		["en", "Usage resets at the start of each UTC calendar month."],
		["es", "El uso se reinicia al comienzo de cada mes natural UTC."],
	]) {
		const rendered = await renderBillingEmail({
			to: "heldout@example.test",
			locale,
			kind: "threshold",
			url: "https://example.test/usage",
			threshold: 95,
			periodEnd: "2026-11-01T00:00:00.000Z",
		});
		expect(rendered.html).toContain(copy);
		expect(rendered.text).toContain(copy);
	}
});

it("phase5-task-04 durable-dedupe-rollback-recipient-recheck", async () => {
	const f = await fixture();
	const { deliverBillingNotices } = await load(
		"packages/email/src/billing.tsx",
	);
	const manager = await f.user(),
		mid = await f.member(f.owner, f.org, manager);
	await f.tenancy.transitionMembership(f.owner, f.org, {
		membershipId: mid,
		role: "billing",
		billable: false,
		status: "active",
		operationKey: randomUUID(),
	});
	const enqueue = () =>
		tx(f, (c) =>
			usage.enqueueBillingNotice(c, f.org, "hidden-threshold", "threshold", {
				threshold: 95,
				periodEnd: "2026-11-01T00:00:00.000Z",
			}),
		);
	await enqueue();
	await enqueue();
	await expect(
		tx(f, async (c) => {
			await usage.enqueueBillingNotice(c, f.org, "rolled-back", "billing", {});
			throw new Error("rollback");
		}),
	).rejects.toThrow();
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.billing_notices WHERE organization_id=$1",
				[f.org],
			)
		).rows[0].n,
	).toBe(1);
	const options = {
		secret: f.installation.env.AUTH_SECRET,
		origin: "http://localhost:3000",
		ready: f.authorization.publication,
		authorize: (c: PoolClient, u: string, o: string) =>
			f.authorization.authorize(c, u, o, "billing"),
	};
	expect(
		(
			await deliverBillingNotices(f.workerPool, {
				...options,
				transport: async () => {
					throw new Error("delivery interrupted");
				},
			})
		).failed,
	).toBe(2);
	const pending = (
		await f.app.query(
			"SELECT encrypted_payload FROM tenancy.billing_deliveries WHERE organization_id=$1",
			[f.org],
		)
	).rows;
	expect(pending).toHaveLength(2);
	expect(JSON.stringify(pending)).not.toContain("example.test");
	await f.tenancy.transitionMembership(f.owner, f.org, {
		membershipId: mid,
		role: "billing",
		billable: false,
		status: "inactive",
		operationKey: randomUUID(),
	});
	await f.app.query(
		"UPDATE tenancy.billing_deliveries SET available_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1",
		[f.org],
	);
	const sent: { text: string }[] = [];
	const transport = async (message: { text: string }) => {
		sent.push(message);
	};
	await deliverBillingNotices(f.workerPool, { ...options, transport });
	await deliverBillingNotices(f.workerPool, { ...options, transport });
	expect(sent).toHaveLength(1);
	expect(sent[0].text).toContain(
		"Usage resets at the start of each UTC calendar month.",
	);
	const rows = (
		await f.app.query(
			"SELECT user_id,state,encrypted_payload FROM tenancy.billing_deliveries WHERE organization_id=$1",
			[f.org],
		)
	).rows;
	expect(
		rows.find((r: { user_id: string }) => r.user_id === manager.userId),
	).toMatchObject({ state: "revoked", encrypted_payload: "" });
	expect(
		rows.find((r: { user_id: string }) => r.user_id === f.owner.userId),
	).toMatchObject({ state: "delivered", encrypted_payload: "" });
});

it("phase5-task-05 observed-five-seeded-regressions-and-diagnosis", async () => {
	const f = await fixture();
	const unsafe = await load("review-billing/service.mjs");
	await f.app.query(
		await readFile(path.join(candidate, "review-billing/schema.sql"), "utf8"),
	);
	await f.checkout();
	// Permission: the canonical service rejects an outsider, the seeded service accepts.
	await expect(f.service.get(f.outsider, f.org)).rejects.toThrow();
	const leaked = await unsafe.readBilling(f.web, f.outsider, f.org);
	expect(leaked).toHaveLength(1);
	// DTO: provider-internal customer and environment fields cross the public boundary.
	expect(leaked[0].customer_id).toBe("cus_synthetic");
	expect(leaked[0].environment).toBe("test:acct_synthetic");
	// RLS: the restricted role can see another tenant without any context setting.
	const key = randomUUID();
	await unsafe.recordUsage(f.web, f.outsider, f.org, {
		operationKey: key,
		quantity: 9,
		internalNote: "private evaluator note",
	});
	const unscoped = (await f.web.query("SELECT * FROM tenancy.review_usage"))
		.rows;
	expect(
		unscoped.some(
			(r: { organization_id: string; internal_note: string }) =>
				r.organization_id === f.org &&
				r.internal_note === "private evaluator note",
		),
	).toBe(true);
	const rls = (
		await f.app.query(
			"SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='tenancy.review_usage'::regclass",
		)
	).rows[0];
	expect(rls).toEqual({ relrowsecurity: false, relforcerowsecurity: false });
	// Provider trust: a caller's claimed seats changes actual tenant capacity without provider truth.
	await unsafe.applyProviderPayload(f.web, f.outsider, f.org, {
		confirmedSeats: 999,
	});
	expect(
		(
			await f.app.query(
				"SELECT capacity FROM tenancy.seat_capacities WHERE organization_id=$1",
				[f.org],
			)
		).rows[0].capacity,
	).toBe(999);
	// Quota/idempotency: zero allowance denies canonical reserve; unsafe writes still succeed twice.
	await expect(
		tx(f, (c) =>
			usage.reserveProjectUsage(c, f.org, randomUUID(), 1, {
				kind: "limited",
				limit: 0,
			}),
		),
	).rejects.toThrow();
	const second = await unsafe.recordUsage(f.web, f.outsider, f.org, {
		operationKey: key,
		quantity: 9,
		internalNote: "private evaluator note",
	});
	expect(second).not.toBe(unscoped[0].id);
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.review_usage WHERE operation_key=$1",
				[key],
			)
		).rows[0].n,
	).toBe(2);
	expect(
		(
			await f.app.query(
				"SELECT id FROM tenancy.usage_events WHERE organization_id=$1",
				[f.org],
			)
		).rows,
	).toEqual([]);
	const review = await readFile(
		path.join(candidate, "BILLING-REVIEW.md"),
		"utf8",
	);
	for (const pattern of [
		/permission|authoriz/i,
		/DTO|leak|looseObject/i,
		/RLS|row.level/i,
		/provider|entitlement/i,
		/quota|idempoten/i,
		/review-billing\/(service\.mjs|schema\.sql|contracts\.mjs)/,
		/reject|not ship|unsafe|block/i,
	])
		expect(review).toMatch(pattern);
	console.log(
		"SEEDED_FAILURES_OBSERVED=missing-permission,dto-leak,missing-rls,provider-trust,quota-bypass",
	);
});
