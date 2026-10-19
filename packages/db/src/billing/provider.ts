export interface ProviderPrice {
	id: string;
	currency: string;
	amount: number;
	interval: "month" | "year";
	active: boolean;
}
export interface ProviderSubscription {
	id: string;
	customerId: string;
	price: ProviderPrice;
	itemId: string;
	scheduleId: string | null;
	quantity: number;
	status: string;
	periodStart: Date;
	periodEnd: Date;
	trialEnd: Date | null;
	cancelAt: Date | null;
	pending: boolean;
	scheduled: {
		id: string;
		priceId: string;
		quantity: number;
		effectiveAt: string;
	} | null;
}
interface ProviderInvoice {
	id: string;
	currency: string;
	amountDue: number;
	amountPaid: number;
	status: string;
	hostedUrl: string | null;
	periodStart: string;
	periodEnd: string;
}
export interface ProviderTruth {
	subscription: ProviderSubscription | null;
	invoices: ProviderInvoice[];
}
export interface BillingProvider {
	environment: string;
	verify(
		raw: Buffer,
		signature: string,
	): {
		id: string;
		type: string;
		customerId: string | null;
		apiVersion: string | null;
		quarantine: string | null;
	};
	customer(commandId: string, organizationId: string): Promise<string>;
	price(id: string): Promise<ProviderPrice>;
	truth(customerId: string): Promise<ProviderTruth>;
	preview(
		customerId: string,
		subscription: ProviderSubscription,
		priceId: string,
		quantity: number,
		prorationDate: number,
		decrease: boolean,
	): Promise<{ amount: number; currency: string }>;
	checkout(input: {
		commandId: string;
		customerId: string;
		priceId: string;
		quantity: number;
		returnUrl: string;
		expiresAt: number;
		trialDays: number;
	}): Promise<{ id: string; url: string }>;
	portal(input: {
		commandId: string;
		customerId: string;
		returnUrl: string;
	}): Promise<{ id: string; url: string }>;
	change(input: {
		commandId: string;
		subscription: ProviderSubscription;
		priceId: string;
		quantity: number;
		prorationDate: number;
		decrease: boolean;
	}): Promise<void>;
	cancel(commandId: string, subscription: ProviderSubscription): Promise<void>;
}
/** Optional rating/invoicing adapter. No implementation is enabled in Phase 5. */
export interface UsageBillingProvider {
	readonly enabled: false;
	readonly chargeOwner: "external-usage-provider";
	deliver(input: {
		eventId: string;
		organizationId: string;
		metric: string;
		metricVersion: number;
		quantity: number;
		occurredAt: string;
		correctionOf: string | null;
	}): Promise<{ receipt: string }>;
	reconcile(input: {
		organizationId: string;
		periodStart: string;
		periodEnd: string;
	}): Promise<{ watermark: string; currency: string; finalizedAmount: string }>;
}
