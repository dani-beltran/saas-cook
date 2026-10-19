import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import Stripe from "stripe";
import { installBillingCatalogue } from "../../packages/db/src/billing/catalogue";
import { createBillingService } from "../../packages/db/src/billing/service";
import {
	createStripeProvider,
	stripeApiVersion,
} from "../../packages/db/src/billing/stripe";
import { createBillingWorker } from "../../packages/db/src/billing/worker";
import { sourceFingerprint } from "../phase1/source-fingerprint";
import { resourceFixture } from "../phase3/fixture";
import { startWebhookForwarder } from "./webhook-forwarder";

const { values } = parseArgs({
	options: {
		"env-file": { type: "string" },
		"stripe-cli": { type: "string" },
		"hosted-checkout": { type: "boolean" },
	},
});
if (values["env-file"]) loadEnvFile(values["env-file"]);
const report = {
	schemaVersion: 1,
	runId: randomUUID(),
	startedAt: new Date().toISOString(),
	sdk: Stripe.PACKAGE_VERSION,
	apiVersion: stripeApiVersion,
	sourceFingerprint: await sourceFingerprint(),
	checks: [] as { name: string; passed: boolean }[],
	diagnostics: {} as Record<string, unknown>,
	limitations: [
		"Hosted Checkout session creation does not prove browser payment completion.",
		"Real webhook delivery/signature ingress requires a Stripe CLI or configured endpoint; locally signed fixtures do not satisfy it.",
	],
	accepted: false,
	stage: "configuration",
	failure: null as string | null,
};
await mkdir("artifacts/phase5", { recursive: true });
let cleanup: undefined | (() => Promise<void>),
	stripe: Stripe | undefined,
	clockId: string | undefined,
	productId: string | undefined,
	priceId: string | undefined,
	fixedPriceId: string | undefined,
	portalId: string | undefined,
	forwarder: Awaited<ReturnType<typeof startWebhookForwarder>> | undefined;
try {
	const secret = process.env.STRIPE_SECRET_KEY;
	if (!secret?.startsWith("sk_test_"))
		throw new Error("Test credentials required");
	stripe = new Stripe(secret, {
		apiVersion: stripeApiVersion,
		maxNetworkRetries: 0,
		timeout: 15000,
	});
	const account = await stripe.accounts.retrieve(null);
	if (
		process.env.STRIPE_ACCOUNT_ID &&
		process.env.STRIPE_ACCOUNT_ID !== account.id
	)
		throw new Error("Account mismatch");
	report.stage = "synthetic-provider-setup";
	const clock = await stripe.testHelpers.testClocks.create({
		frozen_time: Math.floor(Date.now() / 1000),
		name: `Phase 5 ${report.runId}`,
	});
	clockId = clock.id;
	const product = await stripe.products.create({
		name: `Synthetic Phase 5 ${report.runId}`,
		metadata: { phase5_run: report.runId },
	});
	productId = product.id;
	const price = await stripe.prices.create({
		product: product.id,
		currency: "eur",
		unit_amount: 1000,
		recurring: { interval: "month" },
		metadata: { phase5_run: report.runId },
	});
	priceId = price.id;
	const portal = await stripe.billingPortal.configurations.create({
		business_profile: { headline: "Synthetic Phase 5 sandbox" },
		features: {
			customer_update: { enabled: false },
			invoice_history: { enabled: true },
			payment_method_update: { enabled: true },
			subscription_update: { enabled: false },
			subscription_cancel: { enabled: false },
		},
	});
	portalId = portal.id;
	const f = await resourceFixture(),
		workerPool = new Pool({
			connectionString: f.installation.env.WORKER_DATABASE_URL,
		});
	cleanup = async () => {
		await workerPool.end();
		await f.cleanup();
	};
	if (values["stripe-cli"]) {
		forwarder = await startWebhookForwarder(
			f.web,
			{
				secretKey: secret,
				accountId: account.id,
				mode: "test",
				webhookSecret: "whsec_pending",
				portalConfigurationId: portal.id,
			},
			values["stripe-cli"],
		);
		report.diagnostics.listenerApiVersion = forwarder.apiVersion;
	}
	const owner = await f.user(),
		org = (await f.organization(owner)).id;
	await installBillingCatalogue(f.app, {
		environment: `test:${account.id}`,
		plans: [
			{
				plan: {
					id: "sandbox/v1",
					key: "sandbox",
					version: 1,
					name: "Synthetic sandbox",
					mode: "seat",
					features: {
						projects: { kind: "limited", limit: 20 },
						projectCreates: { kind: "limited", limit: 100 },
						seats: 1,
					},
					graceHours: 24,
					snapshotHours: 24,
				},
				price: {
					id: price.id,
					currency: "eur",
					amount: 1000,
					interval: "month",
				},
			},
		],
	});
	const provider = createStripeProvider({
			secretKey: secret,
			accountId: account.id,
			mode: "test",
			webhookSecret:
				process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_unused_by_api_suite",
			portalConfigurationId: portal.id,
			testClock: clock.id,
		}),
		service = createBillingService(f.web, f.authorization, {
			provider,
			origin: "http://localhost:3000",
		}),
		worker = createBillingWorker(workerPool, f.authorization, {
			provider,
			origin: "http://localhost:3000",
		});
	async function check(name: string, work: () => Promise<void>) {
		report.stage = name;
		try {
			await work();
			report.checks.push({ name, passed: true });
		} catch (e) {
			report.checks.push({ name, passed: false });
			throw e;
		}
	}
	let customerId = "",
		subscriptionId = "";
	await check(
		"hosted-checkout-creation-and-no-unconfirmed-access",
		async () => {
			const command = await service.command(owner, org, {
				kind: "checkout",
				operationKey: randomUUID(),
				selection: { planVersionId: "sandbox/v1", quantity: 5 },
				locale: "en",
			});
			await worker.processAccount(org);
			const row = (
				await f.app.query(
					"SELECT state,result FROM tenancy.billing_commands WHERE id=$1",
					[command.id],
				)
			).rows[0];
			assert.equal(row.state, "complete");
			assert.match(row.result.id, /^cs_test_/);
			assert.equal((await service.get(owner, org)).accessState, "free");
			customerId = (
				await f.app.query(
					"SELECT customer_id FROM tenancy.billing_accounts WHERE organization_id=$1",
					[org],
				)
			).rows[0].customer_id;
			if (values["hosted-checkout"]) {
				const hosted = createServer((req, res) => {
					if (req.url !== "/checkout") {
						res.writeHead(404).end();
						return;
					}
					res
						.writeHead(303, {
							location: row.result.url,
							"cache-control": "no-store",
						})
						.end();
				});
				await new Promise<void>((resolve) =>
					hosted.listen(3195, "127.0.0.1", resolve),
				);
				console.info(
					"Synthetic hosted Checkout is ready at http://127.0.0.1:3195/checkout; use Stripe test card 4242 4242 4242 4242, a future expiry and synthetic billing details. This listener expires after 20 minutes.",
				);
				let completed = false;
				try {
					for (let i = 0; i < 240; i++) {
						await new Promise((resolve) => setTimeout(resolve, 5000));
						const session = await stripe?.checkout.sessions.retrieve(
							row.result.id,
						);
						if (
							session?.status === "complete" &&
							session.payment_status === "paid"
						) {
							subscriptionId =
								typeof session.subscription === "string"
									? session.subscription
									: (session.subscription?.id ?? "");
							completed = !!subscriptionId;
							break;
						}
					}
				} finally {
					await new Promise<void>((resolve) => hosted.close(() => resolve()));
				}
				assert(completed, "Hosted sandbox payment remains incomplete");
				await worker.processAccount(org);
				assert.equal((await service.get(owner, org)).accessState, "active");
				report.checks.push({
					name: "hosted-checkout-browser-payment-confirmed",
					passed: true,
				});
				report.limitations = report.limitations.filter(
					(s) => !s.startsWith("Hosted Checkout"),
				);
			} else await stripe?.checkout.sessions.expire(row.result.id);
		},
	);
	await check("restricted-hosted-portal", async () => {
		const command = await service.command(owner, org, {
			kind: "portal",
			operationKey: randomUUID(),
		});
		await worker.processAccount(org);
		const row = (
			await f.app.query(
				"SELECT state,result FROM tenancy.billing_commands WHERE id=$1",
				[command.id],
			)
		).rows[0];
		assert.equal(row.state, "complete");
		assert.match(row.result.url, /^https:\/\/billing\.stripe\.com\//);
	});
	await check("confirmed-seat-subscription-and-invoice", async () => {
		if (!stripe) throw new Error();
		const payment = await stripe.paymentMethods.attach("pm_card_visa", {
			customer: customerId,
		});
		await stripe.customers.update(customerId, {
			invoice_settings: { default_payment_method: payment.id },
		});
		const subscription = subscriptionId
			? await stripe.subscriptions.retrieve(subscriptionId)
			: await stripe.subscriptions.create(
					{
						customer: customerId,
						items: [{ price: price.id, quantity: 5 }],
						payment_behavior: "error_if_incomplete",
						metadata: { phase5_run: report.runId },
					},
					{ idempotencyKey: `phase5:${report.runId}:subscription` },
				);
		subscriptionId = subscription.id;
		await worker.processAccount(org);
		const snapshot = await service.get(owner, org);
		assert.equal(snapshot.accessState, "active");
		assert.equal(snapshot.seats.capacity, 5);
		assert(snapshot.invoices.some((i) => i.status === "paid"));
	});
	await check(
		"immediate-paid-upgrade-preview-and-ambiguous-response",
		async () => {
			const preview = await service.preview(owner, org, {
				planVersionId: "sandbox/v1",
				quantity: 7,
			});
			assert.equal(preview.decrease, false);
			const command = await service.command(owner, org, {
				kind: "change",
				previewId: preview.id,
				operationKey: randomUUID(),
			});
			const originalChange = provider.change;
			let writes = 0;
			provider.change = async (input) => {
				writes++;
				await originalChange(input);
				throw new Error("Synthetic lost response after real provider success");
			};
			try {
				await worker.processAccount(org);
				const invoicesAfterCharge = (await provider.truth(customerId)).invoices
					.length;
				await f.app.query(
					"UPDATE tenancy.billing_commands SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
					[command.id],
				);
				await worker.processAccount(org);
				assert.equal(writes, 1);
				assert.equal(
					(await provider.truth(customerId)).invoices.length,
					invoicesAfterCharge,
				);
				assert.equal(
					(await service.get(owner, org)).commands.find(
						(c) => c.id === command.id,
					)?.state,
					"complete",
				);
			} finally {
				provider.change = originalChange;
			}
			assert.equal((await service.get(owner, org)).seats.capacity, 7);
		},
	);
	await check("renewal-downgrade-schedule", async () => {
		const preview = await service.preview(owner, org, {
			planVersionId: "sandbox/v1",
			quantity: 3,
		});
		assert.equal(preview.decrease, true);
		await service.command(owner, org, {
			kind: "change",
			previewId: preview.id,
			operationKey: randomUUID(),
		});
		await worker.processAccount(org);
		const snapshot = await service.get(owner, org);
		assert.equal(snapshot.seats.capacity, 7);
		assert.equal(snapshot.scheduled?.quantity, 3);
	});
	async function advance(to: number) {
		if (!stripe) throw new Error();
		await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: to });
		for (let i = 0; i < 60; i++) {
			const state = await stripe.testHelpers.testClocks.retrieve(clock.id);
			if (state.status === "ready") return;
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
		throw new Error("Clock timeout");
	}
	await check("missed-event-reconciliation-at-renewal", async () => {
		const truth = await provider.truth(customerId);
		assert(truth.subscription);
		await advance(truth.subscription.periodEnd.getTime() / 1000 + 60);
		await worker.processAccount(org);
		assert.equal((await service.get(owner, org)).seats.capacity, 3);
		if (!stripe) throw new Error();
		const renewed = await stripe.subscriptions.retrieve(subscriptionId);
		const invoiceId =
			typeof renewed.latest_invoice === "string"
				? renewed.latest_invoice
				: renewed.latest_invoice?.id;
		assert(invoiceId);
		const invoice = await stripe.invoices.retrieve(invoiceId);
		if (invoice.status === "draft")
			await stripe.invoices.finalizeInvoice(invoiceId);
		if ((await stripe.invoices.retrieve(invoiceId)).status !== "paid")
			await stripe.invoices.pay(invoiceId);
		await worker.processAccount(org);
		assert.equal((await service.get(owner, org)).providerStatus, "active");
	});
	await check("delinquency-and-payment-recovery", async () => {
		if (!stripe) throw new Error();
		const declined = await stripe.paymentMethods.attach(
			"pm_card_chargeCustomerFail",
			{ customer: customerId },
		);
		await stripe.customers.update(customerId, {
			invoice_settings: { default_payment_method: declined.id },
		});
		const truth = await provider.truth(customerId);
		assert(truth.subscription);
		await advance(truth.subscription.periodEnd.getTime() / 1000 + 60);
		// Renewal creates a draft invoice before the automatic payment delay. Finalize
		// that real invoice and explicitly attempt its configured declining method.
		const renewal = await stripe.subscriptions.retrieve(subscriptionId);
		const renewalId =
			typeof renewal.latest_invoice === "string"
				? renewal.latest_invoice
				: renewal.latest_invoice?.id;
		assert(renewalId);
		const renewalInvoice = await stripe.invoices.retrieve(renewalId);
		report.diagnostics.beforeDecline = {
			subscription: renewal.status,
			invoice: renewalInvoice.status,
		};
		if (renewalInvoice.status === "draft")
			await stripe.invoices.finalizeInvoice(renewalId);
		try {
			await stripe.invoices.pay(renewalId, { payment_method: declined.id });
		} catch (error) {
			if (!(error instanceof Stripe.errors.StripeCardError)) throw error;
		}
		report.diagnostics.afterDecline = {
			subscription: (await stripe.subscriptions.retrieve(subscriptionId))
				.status,
			invoice: (await stripe.invoices.retrieve(renewalId)).status,
		};
		await worker.processAccount(org);
		report.diagnostics.declineProjection = {
			status: (await service.get(owner, org)).providerStatus,
			health: (await service.get(owner, org)).health,
		};
		assert(
			["past_due", "unpaid"].includes(
				(await service.get(owner, org)).providerStatus,
			),
		);
		const payment = await stripe.paymentMethods.attach("pm_card_visa", {
			customer: customerId,
		});
		await stripe.customers.update(customerId, {
			invoice_settings: { default_payment_method: payment.id },
		});
		const s = await stripe.subscriptions.retrieve(subscriptionId);
		const invoice =
			typeof s.latest_invoice === "string"
				? s.latest_invoice
				: s.latest_invoice?.id;
		assert(invoice);
		await stripe.invoices.pay(invoice, { payment_method: payment.id });
		await worker.processAccount(org);
		assert.equal((await service.get(owner, org)).accessState, "active");
	});
	await check("scheduled-cancellation", async () => {
		await service.command(owner, org, {
			kind: "cancel",
			operationKey: randomUUID(),
		});
		await worker.processAccount(org);
		const s = await service.get(owner, org);
		assert(s.cancelAt);
		await advance(new Date(s.cancelAt).getTime() / 1000 + 60);
		await worker.processAccount(org);
		assert.equal((await service.get(owner, org)).accessState, "canceled");
	});
	await check("fixed-plan-trial-and-paid-conversion", async () => {
		if (!stripe) throw new Error();
		const fixed = await stripe.prices.create({
			product: product.id,
			currency: "eur",
			unit_amount: 1200,
			recurring: { interval: "month" },
			metadata: { phase5_run: report.runId },
		});
		fixedPriceId = fixed.id;
		await installBillingCatalogue(f.app, {
			environment: provider.environment,
			plans: [
				{
					plan: {
						id: "fixed/v1",
						key: "fixed",
						version: 1,
						name: "Synthetic fixed trial",
						mode: "fixed",
						trialDays: 7,
						features: {
							projects: { kind: "limited", limit: 20 },
							projectCreates: { kind: "limited", limit: 100 },
							seats: 3,
						},
						graceHours: 24,
						snapshotHours: 24,
					},
					price: {
						id: fixed.id,
						currency: "eur",
						amount: 1200,
						interval: "month",
					},
				},
			],
		});
		const fixedOrg = (await f.organization(owner)).id;
		await assert.rejects(() =>
			service.command(owner, fixedOrg, {
				kind: "checkout",
				selection: { planVersionId: "fixed/v1", quantity: 2 },
				locale: "es",
				operationKey: randomUUID(),
			}),
		);
		const checkout = await service.command(owner, fixedOrg, {
			kind: "checkout",
			selection: { planVersionId: "fixed/v1", quantity: 1 },
			locale: "es",
			operationKey: randomUUID(),
		});
		await worker.processAccount(fixedOrg);
		const command = (
			await f.app.query(
				"SELECT state,result,input FROM tenancy.billing_commands WHERE id=$1",
				[checkout.id],
			)
		).rows[0];
		assert.equal(command.state, "complete");
		assert.equal(command.input.trialDays, 7);
		assert.equal((await service.get(owner, fixedOrg)).accessState, "free");
		await stripe.checkout.sessions.expire(command.result.id);
		const customer = (
			await f.app.query(
				"SELECT customer_id FROM tenancy.billing_accounts WHERE organization_id=$1",
				[fixedOrg],
			)
		).rows[0].customer_id;
		const payment = await stripe.paymentMethods.attach("pm_card_visa", {
			customer,
		});
		await stripe.customers.update(customer, {
			invoice_settings: { default_payment_method: payment.id },
		});
		const trial = await stripe.subscriptions.create(
			{
				customer,
				items: [{ price: fixed.id, quantity: 1 }],
				trial_period_days: 7,
				metadata: { phase5_run: report.runId },
			},
			{ idempotencyKey: `phase5:${report.runId}:fixed-trial` },
		);
		await worker.processAccount(fixedOrg);
		let snapshot = await service.get(owner, fixedOrg);
		assert.equal(snapshot.accessState, "trial");
		assert.equal(snapshot.seats.capacity, 3);
		assert(trial.trial_end);
		await advance(trial.trial_end + 60);
		const active = await stripe.subscriptions.retrieve(trial.id),
			invoice =
				typeof active.latest_invoice === "string"
					? active.latest_invoice
					: active.latest_invoice?.id;
		assert(invoice);
		if ((await stripe.invoices.retrieve(invoice)).status === "draft")
			await stripe.invoices.finalizeInvoice(invoice);
		if ((await stripe.invoices.retrieve(invoice)).status !== "paid")
			await stripe.invoices.pay(invoice);
		await worker.processAccount(fixedOrg);
		snapshot = await service.get(owner, fixedOrg);
		assert.equal(snapshot.accessState, "active");
		assert.equal(snapshot.planVersionId, "fixed/v1");
		assert(
			snapshot.invoices.some(
				(i) => i.status === "paid" && i.amountPaid === 1200,
			),
		);
	});
	if (forwarder)
		await check("real-signed-webhook-delivery-and-replay", async () => {
			for (let i = 0; i < 20 && forwarder?.counts().received === 0; i++)
				await new Promise((r) => setTimeout(r, 500));
			assert(forwarder);
			assert(forwarder.counts().received > 0);
			await forwarder.replay();
			await worker.processAccount(org);
			const receipt = await f.app.query(
				"SELECT state,reason,api_version,count(*)::int AS count FROM foundation.billing_inbox WHERE customer_id=$1 GROUP BY state,reason,api_version",
				[customerId],
			);
			report.diagnostics.webhooks = {
				...forwarder.counts(),
				receipts: receipt.rows,
			};
			assert(receipt.rows.some((r) => r.state === "processed" && r.count > 0));
			report.limitations = report.limitations.filter(
				(s) => !s.startsWith("Real webhook"),
			);
		});
	report.stage = "completed-api-subset";
	report.accepted = report.limitations.length === 0;
} catch (error) {
	report.diagnostics.failureLocation =
		error instanceof Error
			? error.stack
					?.split("\n")
					.find((line) => line.includes("stripe-sandbox.ts:"))
					?.trim()
			: undefined;
	report.failure =
		error instanceof Stripe.errors.StripeError
			? error.type
			: "Prerequisite or assertion failure";
	process.exitCode = 1;
} finally {
	await forwarder?.close();
	await cleanup?.().catch(() => {
		report.limitations.push(
			"Local test installation cleanup failed; inspect retained database diagnostics.",
		);
		process.exitCode = 1;
	});
	if (stripe) {
		if (clockId)
			await stripe.testHelpers.testClocks.del(clockId).catch(() => {
				report.limitations.push("Synthetic test clock cleanup pending.");
			});
		for (const id of [priceId, fixedPriceId].filter((id): id is string => !!id))
			await stripe.prices.update(id, { active: false }).catch(() => {
				report.limitations.push("Synthetic price cleanup pending.");
			});
		if (productId)
			await stripe.products
				.update(productId, { active: false })
				.catch(() => {});
		if (portalId)
			await stripe.billingPortal.configurations
				.update(portalId, { active: false })
				.catch(() => {});
	}
	const path = `artifacts/phase5/stripe-sandbox-${report.runId}.json`;
	await writeFile(path, JSON.stringify(report, null, 2));
	console.info(
		`Stripe sandbox evidence: ${path}; ${report.checks.filter((c) => c.passed).length} API checks passed. Remaining provider limitations: ${report.limitations.length}.`,
	);
}
