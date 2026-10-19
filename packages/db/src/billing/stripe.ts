import Stripe from "stripe";
import { BillingError } from "./policy";
import type {
	BillingProvider,
	ProviderPrice,
	ProviderSubscription,
} from "./provider";
export const stripeApiVersion = "2026-09-30.endive" as const;
const objectId = (v: string | { id: string } | null) =>
	typeof v === "string" ? v : (v?.id ?? null);
const date = (v: number | null | undefined) => (v ? new Date(v * 1000) : null);
function priceDto(p: Stripe.Price): ProviderPrice {
	if (
		p.type !== "recurring" ||
		p.recurring?.usage_type !== "licensed" ||
		p.recurring.interval_count !== 1 ||
		!["month", "year"].includes(p.recurring.interval) ||
		p.unit_amount === null ||
		p.billing_scheme !== "per_unit" ||
		p.transform_quantity
	)
		throw new BillingError("REVIEW");
	return {
		id: p.id,
		currency: p.currency,
		amount: p.unit_amount,
		interval: p.recurring.interval as "month" | "year",
		active: p.active,
	};
}
export function createStripeProvider(options: {
	secretKey: string;
	accountId: string;
	mode: "test" | "live";
	webhookSecret: string;
	portalConfigurationId: string;
	testClock?: string;
}): BillingProvider {
	if (
		!options.secretKey.startsWith(
			options.mode === "test" ? "sk_test_" : "sk_live_",
		)
	)
		throw new BillingError("INVALID");
	if (options.testClock && options.mode !== "test")
		throw new BillingError("INVALID");
	const stripe = new Stripe(options.secretKey, {
		apiVersion: stripeApiVersion,
		maxNetworkRetries: 0,
		timeout: 8000,
	});
	const environment = `${options.mode}:${options.accountId}`;
	let checked = false;
	async function account() {
		if (!checked) {
			const value = await stripe.accounts.retrieve(null);
			if (value.id !== options.accountId) throw new BillingError("REVIEW");
			checked = true;
		}
	}
	const request = (key: string) => ({ idempotencyKey: `saas-cook:p5:${key}` });
	async function subscriptionDto(
		s: Stripe.Subscription,
	): Promise<ProviderSubscription> {
		if (
			s.items.has_more ||
			s.items.data.length !== 1 ||
			s.collection_method !== "charge_automatically"
		)
			throw new BillingError("REVIEW");
		const item = s.items.data[0],
			customerId = objectId(s.customer);
		if (!item || !customerId || !item.quantity)
			throw new BillingError("REVIEW");
		let scheduled: ProviderSubscription["scheduled"] = null;
		if (s.schedule) {
			const schedule = await stripe.subscriptionSchedules.retrieve(
				objectId(s.schedule) as string,
			);
			const future = schedule.phases.find(
				(p) => p.start_date >= item.current_period_end,
			);
			if (future) {
				if (future.items.length !== 1) throw new BillingError("REVIEW");
				scheduled = {
					id: schedule.id,
					priceId: objectId(future.items[0].price) as string,
					quantity: future.items[0].quantity ?? 1,
					effectiveAt: new Date(future.start_date * 1000).toISOString(),
				};
			}
		}
		return {
			id: s.id,
			customerId,
			price: priceDto(item.price),
			itemId: item.id,
			scheduleId: objectId(s.schedule),
			quantity: item.quantity,
			status: s.status,
			periodStart: new Date(item.current_period_start * 1000),
			periodEnd: new Date(item.current_period_end * 1000),
			trialEnd: date(s.trial_end),
			cancelAt:
				date(s.cancel_at) ??
				(s.cancel_at_period_end
					? new Date(item.current_period_end * 1000)
					: null),
			pending: !!s.pending_update,
			scheduled,
		};
	}
	return {
		environment,
		verify(raw, signature) {
			const event = stripe.webhooks.constructEvent(
				raw,
				signature,
				options.webhookSecret,
				300,
			);
			const object = event.data.object as {
				customer?: string | { id: string } | null;
			};
			const supported =
				/^(customer\.subscription\.|checkout\.session\.|invoice\.|subscription_schedule\.)/.test(
					event.type,
				);
			return {
				id: event.id,
				type: event.type,
				customerId: objectId(object.customer ?? null),
				apiVersion: event.api_version ?? null,
				quarantine:
					event.livemode !== (options.mode === "live")
						? "mode"
						: event.account && event.account !== options.accountId
							? "account"
							: event.api_version !== stripeApiVersion
								? "version"
								: !supported
									? "ignored"
									: null,
			};
		},
		async customer(commandId, organizationId) {
			await account();
			const c = await stripe.customers.create(
				{
					metadata: {
						billing_command: commandId,
						organization: organizationId,
					},
					...(options.testClock ? { test_clock: options.testClock } : {}),
				},
				request(`${commandId}:customer`),
			);
			return c.id;
		},
		async price(id) {
			await account();
			return priceDto(await stripe.prices.retrieve(id));
		},
		async truth(customerId) {
			await account();
			const [subscriptions, invoices] = await Promise.all([
				stripe.subscriptions.list({
					customer: customerId,
					status: "all",
					limit: 100,
					expand: ["data.items.data.price"],
				}),
				stripe.invoices.list({ customer: customerId, limit: 24 }),
			]);
			if (subscriptions.has_more) throw new BillingError("REVIEW");
			const current = subscriptions.data.filter(
				(s) => !["canceled", "incomplete_expired"].includes(s.status),
			);
			if (current.length > 1) throw new BillingError("REVIEW");
			const selected = current[0] ?? subscriptions.data[0];
			return {
				subscription: selected ? await subscriptionDto(selected) : null,
				invoices: invoices.data.map((i) => ({
					id: i.id,
					currency: i.currency,
					amountDue: i.amount_due,
					amountPaid: i.amount_paid,
					status: i.status ?? "draft",
					hostedUrl: i.hosted_invoice_url ?? null,
					periodStart: new Date(i.period_start * 1000).toISOString(),
					periodEnd: new Date(i.period_end * 1000).toISOString(),
				})),
			};
		},
		async preview(customerId, s, priceId, quantity, prorationDate, decrease) {
			await account();
			const invoice = await stripe.invoices.createPreview({
				customer: customerId,
				subscription: s.id,
				subscription_details: {
					items: [{ id: s.itemId, price: priceId, quantity }],
					proration_behavior: decrease ? "none" : "always_invoice",
					...(decrease ? {} : { proration_date: prorationDate }),
				},
			});
			return { amount: invoice.amount_due, currency: invoice.currency };
		},
		async checkout(input) {
			await account();
			const s = await stripe.checkout.sessions.create(
				{
					customer: input.customerId,
					mode: "subscription",
					line_items: [{ price: input.priceId, quantity: input.quantity }],
					success_url: input.returnUrl,
					cancel_url: input.returnUrl,
					client_reference_id: input.commandId,
					metadata: { billing_command: input.commandId },
					subscription_data: {
						metadata: { billing_command: input.commandId },
						...(input.trialDays > 0
							? { trial_period_days: input.trialDays }
							: {}),
					},
					payment_method_collection: "always",
					allowed_payment_method_types: ["card"],
					expires_at: input.expiresAt,
				},
				request(`${input.commandId}:checkout`),
			);
			if (!s.url) throw new BillingError("OUTAGE");
			return { id: s.id, url: s.url };
		},
		async portal(input) {
			await account();
			const config = await stripe.billingPortal.configurations.retrieve(
				options.portalConfigurationId,
			);
			if (
				!config.active ||
				config.features.subscription_update.enabled ||
				config.features.subscription_cancel.enabled
			)
				throw new BillingError("REVIEW");
			const s = await stripe.billingPortal.sessions.create(
				{
					customer: input.customerId,
					configuration: config.id,
					return_url: input.returnUrl,
				},
				request(`${input.commandId}:portal`),
			);
			return { id: s.id, url: s.url };
		},
		async change(input) {
			await account();
			const s = input.subscription;
			if (input.decrease) {
				const schedule = s.scheduleId
					? await stripe.subscriptionSchedules.retrieve(s.scheduleId)
					: await stripe.subscriptionSchedules.create(
							{ from_subscription: s.id },
							request(`${input.commandId}:schedule-create`),
						);
				await stripe.subscriptionSchedules.update(
					schedule.id,
					{
						end_behavior: "release",
						proration_behavior: "none",
						phases: [
							{
								start_date: s.periodStart.getTime() / 1000,
								end_date: s.periodEnd.getTime() / 1000,
								items: [{ price: s.price.id, quantity: s.quantity }],
								proration_behavior: "none",
							},
							{
								start_date: s.periodEnd.getTime() / 1000,
								items: [{ price: input.priceId, quantity: input.quantity }],
								duration: { interval: s.price.interval, interval_count: 1 },
								proration_behavior: "none",
							},
						],
					},
					request(`${input.commandId}:schedule-update`),
				);
			} else {
				if (s.scheduled) throw new BillingError("CONFLICT");
				if (s.scheduleId)
					await stripe.subscriptionSchedules.release(
						s.scheduleId,
						{},
						request(`${input.commandId}:schedule-release`),
					);
				await stripe.subscriptions.update(
					s.id,
					{
						items: [
							{ id: s.itemId, price: input.priceId, quantity: input.quantity },
						],
						proration_date: input.prorationDate,
						proration_behavior: "always_invoice",
						payment_behavior: "pending_if_incomplete",
					},
					request(`${input.commandId}:change`),
				);
			}
		},
		async cancel(commandId, s) {
			await account();
			if (s.scheduleId)
				await stripe.subscriptionSchedules.release(
					s.scheduleId,
					{},
					request(`${commandId}:schedule-release`),
				);
			await stripe.subscriptions.update(
				s.id,
				{ cancel_at_period_end: true },
				request(`${commandId}:cancel`),
			);
		},
	};
}
