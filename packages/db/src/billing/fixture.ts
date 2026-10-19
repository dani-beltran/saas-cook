import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { createResourceService } from "../resources";
import { planSchema } from "./policy";
import type {
	BillingProvider,
	ProviderSubscription,
	ProviderTruth,
} from "./provider";
import { createBillingService } from "./service";
import { createBillingWorker } from "./worker";
export async function billingFixture() {
	const f = await resourceFixture(),
		workerPool = new Pool({
			connectionString: f.installation.env.WORKER_DATABASE_URL,
		});
	const owner = await f.user(),
		outsider = await f.user(),
		org = (await f.organization(owner)).id,
		otherOrg = (await f.organization(outsider)).id;
	const plan = planSchema.parse({
		id: "team/v1",
		key: "team",
		version: 1,
		name: "Synthetic team",
		mode: "seat",
		features: {
			projects: { kind: "limited", limit: 50 },
			projectCreates: { kind: "limited", limit: 2 },
			seats: 1,
		},
		graceHours: 24,
		snapshotHours: 24,
	});
	await f.app.query(
		"INSERT INTO foundation.plan_versions(id,plan_key,version,definition) VALUES($1,$2,$3,$4)",
		[plan.id, plan.key, plan.version, JSON.stringify(plan)],
	);
	const price = {
		id: "price_synthetic",
		currency: "eur",
		amount: 1000,
		interval: "month" as const,
		active: true,
	};
	await f.app.query(
		"INSERT INTO foundation.billing_prices(environment,price_id,plan_version_id,currency,amount,interval) VALUES('test:acct_synthetic',$1,$2,'eur',1000,'month')",
		[price.id, plan.id],
	);
	let truth: ProviderTruth = { subscription: null, invoices: [] },
		outage = false,
		ambiguous = false;
	const calls: string[] = [];
	const provider: BillingProvider = {
		environment: "test:acct_synthetic",
		verify(raw) {
			return JSON.parse(raw.toString());
		},
		async customer(id) {
			calls.push(`customer:${id}`);
			return "cus_synthetic";
		},
		async price() {
			return price;
		},
		async truth(customer) {
			if (outage) throw new Error("synthetic outage");
			if (customer !== "cus_synthetic") throw new Error("wrong customer");
			return structuredClone(truth);
		},
		async preview() {
			return { amount: 500, currency: "eur" };
		},
		async checkout(input) {
			calls.push(`checkout:${input.commandId}`);
			if (ambiguous) {
				truth = { ...truth, subscription: subscription(input.quantity) };
				throw new Error("lost response");
			}
			return {
				id: "cs_synthetic",
				url: "https://checkout.stripe.com/c/pay/synthetic",
			};
		},
		async portal() {
			return {
				id: "bps_synthetic",
				url: "https://billing.stripe.com/p/session/synthetic",
			};
		},
		async change(input) {
			calls.push(`change:${input.commandId}`);
			if (!truth.subscription) throw new Error("missing");
			if (input.decrease)
				truth.subscription.scheduled = {
					id: "sub_sched_synthetic",
					priceId: input.priceId,
					quantity: input.quantity,
					effectiveAt: truth.subscription.periodEnd.toISOString(),
				};
			else truth.subscription.quantity = input.quantity;
		},
		async cancel() {
			if (truth.subscription)
				truth.subscription.cancelAt = truth.subscription.periodEnd;
		},
	};
	function subscription(quantity = 5, status = "active"): ProviderSubscription {
		return {
			id: "sub_synthetic",
			customerId: "cus_synthetic",
			price,
			itemId: "si_synthetic",
			scheduleId: null,
			quantity,
			status,
			periodStart: new Date(Date.now() - 86400000),
			periodEnd: new Date(Date.now() + 25 * 86400000),
			trialEnd: null,
			cancelAt: null,
			pending: false,
			scheduled: null,
		};
	}
	const service = createBillingService(f.web, f.authorization, {
		provider,
		origin: "http://localhost:3000",
	});
	const worker = createBillingWorker(workerPool, f.authorization, {
		provider,
		origin: "http://localhost:3000",
	});
	const resources = createResourceService(
		f.web,
		{
			authorize: f.authorization.authorizeResource,
			check: f.authorization.checkResource,
			checkBatch: f.authorization.checkResourceBatch,
			sourceCommit: f.authorization.sourceCommit,
		},
		{ defaultProjectCreatesPerMonth: 2 },
	);
	async function checkout() {
		const id = await service.command(owner, org, {
			kind: "checkout",
			selection: { planVersionId: plan.id, quantity: 5 },
			locale: "en",
			operationKey: randomUUID(),
		});
		await worker.processAccount(org);
		return id;
	}
	return {
		...f,
		owner,
		outsider,
		org,
		otherOrg,
		plan,
		price,
		provider,
		worker,
		workerPool,
		service,
		resources,
		calls,
		subscription,
		checkout,
		setTruth(v: ProviderTruth) {
			truth = v;
		},
		getTruth() {
			return truth;
		},
		setOutage(v: boolean) {
			outage = v;
		},
		setAmbiguous(v: boolean) {
			ambiguous = v;
		},
		async cleanup() {
			await workerPool.end();
			await f.cleanup();
		},
	};
}
