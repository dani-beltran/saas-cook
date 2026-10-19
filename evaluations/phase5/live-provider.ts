import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Pool } from "pg";
import type Stripe from "stripe";

/** Supplement to frozen local checks: real Stripe test API, candidate implementation. */
const { values } = parseArgs({
	options: {
		candidate: { type: "string" },
		report: { type: "string" },
	},
});
if (!values.candidate || !values.report)
	throw new Error("Explicit --candidate and --report paths are required");
const candidate = path.resolve(values.candidate);
const reportPath = path.resolve(values.report);
process.chdir(candidate);
const runId = randomUUID();
const report = {
	version: 1,
	runId,
	candidate,
	startedAt: new Date().toISOString(),
	finishedAt: null as string | null,
	accepted: false,
	stage: "configuration",
	apiVersion: null as string | null,
	sourceBefore: {} as Record<string, string>,
	sourceAfter: {} as Record<string, string>,
	sourceFingerprintBefore: null as string | null,
	sourceFingerprintAfter: null as string | null,
	checks: [] as { name: string; passed: boolean }[],
	failure: null as { stage: string; errorType: string } | null,
	cleanup: [] as { name: string; passed: boolean; errorType?: string }[],
	resources: {} as Record<string, string>,
	diagnostics: {} as Record<string, unknown>,
	limitations: [
		"This is real Stripe test-API reconciliation evidence; no hosted Checkout payment was completed.",
		"No real webhook delivery/signature ingress, Customer Portal or provider outage was exercised.",
		"The Stripe test clock is real but is not advanced; local held-out cases separately cover window-accounting behavior.",
		"The billing-account/customer mapping is explicit evaluator-owned synthetic setup using the migrator role.",
	],
};
const hash = (value: string | Buffer) =>
	createHash("sha256").update(value).digest("hex");
function errorType(error: unknown) {
	const name = error instanceof Error ? error.name : "UnknownError";
	return /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(name) ? name : "Error";
}
async function sourceHashes() {
	const found: Record<string, string> = {};
	const excluded = new Set([
		".git",
		"node_modules",
		"artifacts",
		".next",
		"dist",
		".turbo",
		".cache",
		".codex",
		".aws",
		".ssh",
		".config",
		".docker",
		"coverage",
		"storybook-static",
		"test-results",
		"playwright-report",
	]);
	async function visit(relative = "") {
		for (const entry of await readdir(path.join(candidate, relative), {
			withFileTypes: true,
		})) {
			if (
				excluded.has(entry.name) ||
				(entry.name.startsWith(".env") && entry.name !== ".env.example") ||
				entry.name.endsWith(".tsbuildinfo") ||
				entry.name === "next-env.d.ts" ||
				entry.name === ".DS_Store" ||
				/^(credentials?|secrets?|auth)\.(json|ya?ml|toml)$/i.test(entry.name) ||
				/\.(pem|key|p12|pfx|crt)$/i.test(entry.name)
			)
				continue;
			const local = path.join(relative, entry.name);
			if (entry.isSymbolicLink()) throw new Error("UnexpectedSourceSymlink");
			if (entry.isDirectory()) await visit(local);
			else if (entry.isFile())
				found[local.split(path.sep).join("/")] = hash(
					await readFile(path.join(candidate, local)),
				);
		}
	}
	await visit();
	return Object.fromEntries(Object.entries(found).sort());
}
async function check(name: string, work: () => Promise<void>) {
	report.stage = name;
	try {
		await work();
		report.checks.push({ name, passed: true });
	} catch (error) {
		report.checks.push({ name, passed: false });
		throw error;
	}
}
async function clean(name: string, work: () => Promise<unknown>) {
	try {
		await work();
		report.cleanup.push({ name, passed: true });
	} catch (error) {
		report.cleanup.push({ name, passed: false, errorType: errorType(error) });
		report.accepted = false;
	}
}
let stripe: Stripe | undefined;
let workerPool: Pool | undefined;
let cleanupFixture: (() => Promise<void>) | undefined;
let subscriptionId: string | undefined;
let customerId: string | undefined;
let clockId: string | undefined;
let productId: string | undefined;
const priceIds: string[] = [];
try {
	report.sourceBefore = await sourceHashes();
	report.sourceFingerprintBefore = hash(JSON.stringify(report.sourceBefore));
	// The explicit evaluator test credential is never printed or retained.
	const secret = process.env.STRIPE_SECRET_KEY;
	if (!secret?.startsWith("sk_test_"))
		throw new Error("StrictStripeTestCredential");
	assert.ok(secret);
	const requireCandidate = createRequire(path.join(candidate, "package.json"));
	const StripeSDK = requireCandidate(
		"stripe",
	) as typeof import("stripe").default;
	const { Pool: CandidatePool } = requireCandidate("pg") as typeof import("pg");
	const load = (file: string) =>
		import(pathToFileURL(path.join(candidate, file)).href);
	const { resourceFixture } = await load("scripts/phase3/fixture.ts");
	const { installBillingCatalogue } = await load(
		"packages/db/src/billing/catalogue.ts",
	);
	const { installTeamV2, teamV2Plan } = await load(
		"packages/db/src/billing/team-v2.ts",
	);
	const { createProjectTemplateService } = await load(
		"packages/db/src/project-templates.ts",
	);
	const { createMemberSeatService } = await load(
		"packages/db/src/billing/member-seats.ts",
	);
	const { createStripeProvider, stripeApiVersion } = await load(
		"packages/db/src/billing/stripe.ts",
	);
	const { createBillingService, selectedPlan } = await load(
		"packages/db/src/billing/service.ts",
	);
	const { createBillingWorker } = await load(
		"packages/db/src/billing/worker.ts",
	);
	report.apiVersion = stripeApiVersion;
	stripe = new StripeSDK(secret, {
		apiVersion: stripeApiVersion,
		maxNetworkRetries: 0,
		timeout: 15000,
	});
	const sdk = stripe;
	report.stage = "real-stripe-test-setup";
	const account = await sdk.accounts.retrieve(null);
	// Optional evaluator account assertion; its value is never retained.
	const configuredAccount = process.env.STRIPE_ACCOUNT_ID;
	assert.ok(!configuredAccount || configuredAccount === account.id);
	const environment = `test:${account.id}`;
	const clock = await sdk.testHelpers.testClocks.create({
		frozen_time: Math.floor(Date.now() / 1000),
		name: `Phase5 skill evaluation ${runId}`,
	});
	clockId = clock.id;
	report.resources.testClock = clock.id;
	const product = await sdk.products.create({
		name: `Synthetic Phase5 skill evaluation ${runId}`,
		metadata: { phase5_evaluation: runId },
	});
	productId = product.id;
	report.resources.product = product.id;
	const prices = [];
	for (const amount of [1000, 1500]) {
		const price = await sdk.prices.create({
			product: product.id,
			currency: "eur",
			unit_amount: amount,
			recurring: { interval: "month" },
			metadata: { phase5_evaluation: runId },
		});
		priceIds.push(price.id);
		prices.push(price);
	}
	const [v1Price, v2Price] = prices;
	report.resources.v1Price = v1Price.id;
	report.resources.v2Price = v2Price.id;
	const f = await resourceFixture();
	cleanupFixture = f.cleanup;
	workerPool = new CandidatePool({
		connectionString: f.installation.env.WORKER_DATABASE_URL,
	});
	const owner = await f.user();
	const outsider = await f.user();
	const org = (await f.organization(owner)).id;
	const otherOrg = (await f.organization(outsider)).id;
	const member = await f.user();
	const memberId = await f.member(owner, org, member);
	const v1Plan = {
		id: "team/v1",
		key: "team",
		version: 1,
		name: "Sold synthetic Team",
		mode: "seat",
		trialDays: 0,
		features: {
			projects: { kind: "limited", limit: 50 },
			projectCreates: { kind: "limited", limit: 2 },
			seats: 1,
		},
		graceHours: 24,
		snapshotHours: 24,
	};
	await installBillingCatalogue(f.app, {
		environment,
		plans: [
			{
				plan: v1Plan,
				price: {
					id: v1Price.id,
					currency: "eur",
					amount: 1000,
					interval: "month",
				},
			},
		],
	});
	const customer = await sdk.customers.create({
		test_clock: clock.id,
		metadata: { phase5_evaluation: runId, organization: org },
	});
	customerId = customer.id;
	report.resources.customer = customer.id;
	const payment = await sdk.paymentMethods.attach("pm_card_visa", {
		customer: customer.id,
	});
	await sdk.customers.update(customer.id, {
		invoice_settings: { default_payment_method: payment.id },
	});
	const subscription = await sdk.subscriptions.create(
		{
			customer: customer.id,
			items: [{ price: v1Price.id, quantity: 3 }],
			payment_behavior: "error_if_incomplete",
			metadata: { phase5_evaluation: runId },
		},
		{ idempotencyKey: `phase5-evaluation:${runId}:subscription` },
	);
	subscriptionId = subscription.id;
	report.resources.subscription = subscription.id;
	assert.equal(subscription.status, "active");
	await f.app.query(
		"INSERT INTO tenancy.billing_accounts(organization_id,environment,customer_id) VALUES($1,$2,$3)",
		[org, environment, customer.id],
	);
	const providerOptions = {
		secretKey: secret,
		accountId: account.id,
		mode: "test" as const,
		webhookSecret: "whsec_not_exercised_by_api_supplement",
		portalConfigurationId: "bpc_not_exercised_by_api_supplement",
		testClock: clock.id,
	};
	const provider = createStripeProvider(providerOptions);
	const service = createBillingService(f.web, f.authorization, {
		provider,
		origin: "http://localhost:3000",
	});
	const worker = createBillingWorker(workerPool, f.authorization, {
		provider,
		origin: "http://localhost:3000",
	});
	const templates = createProjectTemplateService(f.resources);
	const seats = createMemberSeatService(f.tenancy);
	await check(
		"real-paid-v1-subscription-reconciles-through-candidate",
		async () => {
			await worker.processAccount(org);
			const snapshot = await service.get(owner, org);
			assert.equal(snapshot.planVersionId, "team/v1");
			assert.equal(snapshot.accessState, "active");
			assert.equal(snapshot.seats.capacity, 3);
			assert.equal(snapshot.seats.occupied, 2);
			assert.ok(
				snapshot.invoices.some(
					(invoice: { status: string; amountPaid: number }) =>
						invoice.status === "paid" && invoice.amountPaid === 3000,
				),
			);
		},
	);
	await check(
		"candidate-v2-preserves-sold-plan-and-provider-mapping-isolation",
		async () => {
			const original = (
				await f.app.query(
					"SELECT definition FROM foundation.plan_versions WHERE id='team/v1'",
				)
			).rows[0].definition;
			await installTeamV2(f.app, { environment, priceId: v2Price.id });
			await installTeamV2(f.app, { environment, priceId: v2Price.id });
			assert.deepEqual(
				(
					await f.app.query(
						"SELECT definition FROM foundation.plan_versions WHERE id='team/v1'",
					)
				).rows[0].definition,
				original,
			);
			await worker.processAccount(org);
			const snapshot = await service.get(owner, org);
			assert.equal(snapshot.planVersionId, "team/v1");
			assert.deepEqual(snapshot.usage.policy, { kind: "limited", limit: 2 });
			assert.equal(teamV2Plan.features.projectCreates.limit, 10);
			const client = await f.app.connect();
			try {
				assert.equal(
					(await selectedPlan(client, environment, "team/v2")).price_id,
					v2Price.id,
				);
				await assert.rejects(() =>
					selectedPlan(client, `live:${account.id}`, "team/v2"),
				);
			} finally {
				client.release();
			}
		},
	);
	await check(
		"real-external-downgrade-races-admission-without-member-loss",
		async () => {
			await sdk.subscriptions.update(subscription.id, {
				items: [{ id: subscription.items.data[0].id, quantity: 1 }],
				proration_behavior: "none",
			});
			const third = await f.user();
			const [reconcile, admission] = await Promise.allSettled([
				worker.processAccount(org),
				f.member(owner, org, third),
			]);
			assert.equal(reconcile.status, "fulfilled");
			if (admission.status === "rejected") {
				const reason = admission.reason as { code?: unknown };
				assert.ok(reason?.code === "CAPACITY" || reason?.code === "CONFLICT");
			}
			await worker.processAccount(org);
			const snapshot = await service.get(owner, org);
			const active = (
				await f.app.query(
					"SELECT id,user_id FROM tenancy.memberships WHERE organization_id=$1 AND status='active' AND billable AND seat_counted ORDER BY id",
					[org],
				)
			).rows;
			assert.equal(snapshot.seats.capacity, 1);
			assert.equal(snapshot.seats.occupied, active.length);
			assert.equal(active.length, admission.status === "fulfilled" ? 3 : 2);
			assert.ok(
				active.some((row: { user_id: string }) => row.user_id === owner.userId),
			);
			assert.ok(active.some((row: { id: string }) => row.id === memberId));
			assert.equal(snapshot.seats.overCapacity, true);
			const nextMember = await f.user();
			await assert.rejects(() => f.member(owner, org, nextMember));
			report.diagnostics.admissionWonRace = admission.status === "fulfilled";
			report.diagnostics.occupiedAfterDowngrade = active.length;
			if (admission.status === "fulfilled") {
				const input = {
					membershipId: admission.value,
					operationKey: randomUUID(),
				};
				await seats.deactivate(owner, org, input);
				await seats.deactivate(owner, org, input);
			}
		},
	);
	await check(
		"candidate-deactivation-replays-once-and-rechecks-tenant-authority",
		async () => {
			const input = { membershipId: memberId, operationKey: randomUUID() };
			await assert.rejects(() => seats.deactivate(outsider, org, input));
			await assert.rejects(() => seats.deactivate(owner, otherOrg, input));
			await seats.deactivate(owner, org, input);
			await seats.deactivate(owner, org, input);
			const snapshot = await service.get(owner, org);
			assert.equal(snapshot.seats.capacity, 1);
			assert.equal(snapshot.seats.occupied, 1);
			assert.equal(snapshot.seats.overCapacity, false);
			await assert.rejects(() => f.tenancy.setLocalCapacity(owner, org, 100));
		},
	);
	await check(
		"candidate-template-replay-and-paid-v1-final-quota-race",
		async () => {
			const input = {
				template: "kanban",
				name: "Real-provider quota",
				slug: `provider-${runId}`,
				operationKey: randomUUID(),
			};
			const first = await templates.create(owner, org, input);
			assert.equal(first.description, "Kanban board");
			assert.equal((await templates.create(owner, org, input)).id, first.id);
			await assert.rejects(() => templates.create(outsider, org, input));
			await assert.rejects(() => templates.create(owner, otherOrg, input));
			const race = await Promise.allSettled(
				[1, 2].map((i) =>
					templates.create(owner, org, {
						template: "roadmap",
						name: `Paid quota racer ${i}`,
						slug: `paid-${randomUUID()}`,
						operationKey: randomUUID(),
					}),
				),
			);
			assert.equal(
				race.filter((value) => value.status === "fulfilled").length,
				1,
			);
			assert.equal(
				race.filter((value) => value.status === "rejected").length,
				1,
			);
			assert.equal(
				(
					await f.app.query(
						"SELECT count(*)::int AS n FROM tenancy.usage_events WHERE organization_id=$1 AND correction_of IS NULL",
						[org],
					)
				).rows[0].n,
				2,
			);
			const usage = (await service.get(owner, org)).usage;
			assert.equal(usage.consumed, 2);
			assert.equal(usage.reserved, 0);
		},
	);
	await check(
		"real-provider-v2-switch-reconciles-candidate-feature-definition",
		async () => {
			await sdk.subscriptions.update(subscription.id, {
				items: [
					{ id: subscription.items.data[0].id, price: v2Price.id, quantity: 1 },
				],
				proration_behavior: "none",
				payment_behavior: "error_if_incomplete",
			});
			await worker.processAccount(org);
			const snapshot = await service.get(owner, org);
			assert.equal(snapshot.planVersionId, "team/v2");
			assert.equal(snapshot.accessState, "active");
			assert.equal(snapshot.seats.capacity, 1);
			const stored = (
				await f.app.query(
					"SELECT features FROM tenancy.billing_accounts WHERE organization_id=$1",
					[org],
				)
			).rows[0].features;
			assert.deepEqual(stored.projectCreates, { kind: "limited", limit: 10 });
		},
	);
	await check(
		"real-provider-account-validation-rejects-mismatched-adapter",
		async () => {
			const wrong = createStripeProvider({
				...providerOptions,
				accountId: "acct_phase5wrongaccount",
			});
			await assert.rejects(
				() => wrong.price(v1Price.id),
				(error: unknown) =>
					error instanceof Error && "code" in error && error.code === "REVIEW",
			);
		},
	);
	report.accepted = true;
} catch (error) {
	report.accepted = false;
	report.failure = { stage: report.stage, errorType: errorType(error) };
} finally {
	if (stripe) {
		const sdk = stripe;
		if (subscriptionId) {
			const id = subscriptionId;
			await clean("cancel-synthetic-subscription", () =>
				sdk.subscriptions.cancel(id),
			);
		}
		if (customerId) {
			const id = customerId;
			await clean("delete-synthetic-customer", () => sdk.customers.del(id));
		}
		if (clockId) {
			const id = clockId;
			await clean("delete-synthetic-test-clock", () =>
				sdk.testHelpers.testClocks.del(id),
			);
		}
		for (const [index, id] of priceIds.entries())
			await clean(`deactivate-synthetic-price-${index + 1}`, () =>
				sdk.prices.update(id, { active: false }),
			);
		if (productId) {
			const id = productId;
			await clean("deactivate-synthetic-product", () =>
				sdk.products.update(id, { active: false }),
			);
		}
	}
	if (workerPool) {
		const pool = workerPool;
		await clean("close-worker-pool", () => pool.end());
	}
	if (cleanupFixture)
		await clean("delete-disposable-local-installation", cleanupFixture);
	await clean("candidate-source-unchanged", async () => {
		report.sourceAfter = await sourceHashes();
		report.sourceFingerprintAfter = hash(JSON.stringify(report.sourceAfter));
		assert.deepEqual(report.sourceAfter, report.sourceBefore);
	});
	report.finishedAt = new Date().toISOString();
	await mkdir(path.dirname(reportPath), { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(
		`STRIPE_PHASE5_SUPPLEMENT=${JSON.stringify({ report: reportPath, accepted: report.accepted, passedChecks: report.checks.filter((item) => item.passed).length, failure: report.failure })}`,
	);
	if (!report.accepted) process.exitCode = 1;
}
