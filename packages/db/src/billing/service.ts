import { createHash, randomUUID } from "node:crypto";
import {
	billingCommand as commandSchema,
	billingSelection as selectionSchema,
} from "@saas-cook/api-contracts/inputs/billing";
import type { Pool, PoolClient } from "pg";
import type { z } from "zod";

export {
	billingCommand as commandSchema,
	billingSelection as selectionSchema,
} from "@saas-cook/api-contracts/inputs/billing";

import {
	appendTenantAudit,
	assertAuthorizationCurrent,
	type TenancyHooks,
	type TenantActor,
	withTenantTransaction,
} from "../tenancy";
import {
	BillingError,
	type Limit,
	normalizeAccess,
	type Plan,
	planSchema,
} from "./policy";
import type { BillingProvider, ProviderSubscription } from "./provider";
import { usageSnapshot } from "./usage";

export { BillingError } from "./policy";
export type { UsageBillingProvider } from "./provider";
export interface BillingAccount {
	organization_id: string;
	environment: string;
	customer_id: string | null;
	subscription_id: string | null;
	plan_version_id: string | null;
	provider_status: string;
	access_state: string;
	quantity: number;
	period_start: Date | null;
	period_end: Date | null;
	trial_end: Date | null;
	cancel_at: Date | null;
	grace_end: Date | null;
	valid_until: Date | null;
	source_version: number;
	health: string;
	fingerprint: string;
	features: unknown;
	scheduled: { priceId: string; quantity: number; effectiveAt: string } | null;
	locale: "en" | "es";
	reconciled_at: Date | null;
}
export interface BillingHooks {
	authorize: TenancyHooks["authorize"];
	publication(client: PoolClient): Promise<unknown>;
}
export async function authorizeBilling(
	c: PoolClient,
	actor: TenantActor,
	o: string,
	hooks: BillingHooks,
) {
	const sessionExpiry = await actor.assertCurrent?.();
	const row = (
		await c.query<{
			require_mfa: boolean;
			accept_passkey_mfa: boolean;
			required_auth_method: string | null;
			expires_at: Date | null;
		}>(
			"SELECT o.require_mfa,o.accept_passkey_mfa,o.required_auth_method,m.expires_at FROM tenancy.organizations o JOIN tenancy.memberships m ON m.organization_id=o.id CROSS JOIN LATERAL identity.lookup_user(m.user_id) u WHERE o.id=$1 AND m.user_id=$2 AND o.status='active' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) AND u.lifecycle_status='active' AND u.email_verified",
			[o, actor.userId],
		)
	).rows[0];
	if (
		!row ||
		(row.require_mfa &&
			(!actor.mfa ||
				(actor.method === "passkey" && !row.accept_passkey_mfa))) ||
		(row.required_auth_method && actor.method !== row.required_auth_method)
	)
		throw new BillingError("DENIED");
	await c.query(
		"SELECT set_config('app.authorization_expires_at',coalesce(least(nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz,$1::timestamptz,$2::timestamptz)::text,''),true)",
		[sessionExpiry ?? null, row.expires_at],
	);
	await hooks.authorize(c, actor.userId, o, "billing");
	await assertAuthorizationCurrent(c);
}
export async function accountRow(c: PoolClient, o: string) {
	return (
		await c.query<BillingAccount>(
			"SELECT * FROM tenancy.billing_accounts WHERE organization_id=$1",
			[o],
		)
	).rows[0];
}
export async function selectedPlan(
	c: PoolClient,
	environment: string,
	id: string,
) {
	const row = (
		await c.query<{
			definition: unknown;
			price_id: string;
			currency: string;
			amount: number;
			interval: "month" | "year";
		}>(
			"SELECT p.definition,m.price_id,m.currency,m.amount,m.interval FROM foundation.plan_versions p JOIN foundation.billing_prices m ON m.plan_version_id=p.id WHERE m.environment=$1 AND p.id=$2",
			[environment, id],
		)
	).rows[0];
	if (!row) throw new BillingError("INVALID");
	return { ...row, plan: planSchema.parse(row.definition) };
}
export function purchasedSeats(plan: Plan, quantity: number) {
	if (
		plan.mode === "free" ||
		!Number.isInteger(quantity) ||
		quantity < 1 ||
		quantity > 100000 ||
		(plan.mode === "fixed" && quantity !== 1)
	)
		throw new BillingError("INVALID");
	return plan.mode === "seat" ? quantity : plan.features.seats;
}
export async function verifyPrice(
	provider: BillingProvider,
	selected: Awaited<ReturnType<typeof selectedPlan>>,
	requireActive = true,
) {
	const p = await provider.price(selected.price_id);
	if (
		p.id !== selected.price_id ||
		(requireActive && !p.active) ||
		p.currency !== selected.currency ||
		p.amount !== selected.amount ||
		p.interval !== selected.interval
	)
		throw new BillingError("REVIEW");
}
export async function occupied(c: PoolClient, o: string) {
	return Number(
		(
			await c.query<{ occupied: number }>(
				"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
				[o],
			)
		).rows[0]?.occupied ?? 0,
	);
}
export const billingHash = (input: unknown) =>
	createHash("sha256").update(JSON.stringify(input)).digest("hex");
export function decrease(
	old: ProviderSubscription,
	plan: Plan,
	price: { amount: number },
	quantity: number,
	previousFeatures: unknown,
) {
	const before = previousFeatures as Plan["features"];
	const value = (v: Limit) =>
		v.kind === "limited" ? v.limit : v.kind === "unlimited" ? Infinity : -1;
	return (
		quantity * price.amount < old.quantity * old.price.amount ||
		purchasedSeats(plan, quantity) < (before?.seats ?? old.quantity) ||
		(before?.projects &&
			value(plan.features.projects) < value(before.projects)) ||
		(before?.projectCreates &&
			value(plan.features.projectCreates) < value(before.projectCreates))
	);
}
export function createBillingService(
	pool: Pool,
	hooks: BillingHooks,
	options: {
		provider?: BillingProvider;
		origin: string;
		defaultProjectCreatesPerMonth?: number | null;
	},
) {
	const provider = options.provider;
	const localLimit: Limit =
		options.defaultProjectCreatesPerMonth === null
			? { kind: "unlimited" }
			: {
					kind: "limited",
					limit: options.defaultProjectCreatesPerMonth ?? 1000,
				};
	const tx = <T>(
		actor: TenantActor,
		o: string,
		write: boolean,
		fn: (c: PoolClient) => Promise<T>,
	) =>
		withTenantTransaction(pool, o, [actor.userId], write, async (c) => {
			await authorizeBilling(c, actor, o, hooks);
			const value = await fn(c);
			await assertAuthorizationCurrent(c);
			return value;
		});
	return {
		async get(actor: TenantActor, o: string) {
			return tx(actor, o, false, async (c) => {
				const account = await accountRow(c, o);
				const plans = provider
					? (
							await c.query<{
								definition: unknown;
								currency: string;
								amount: number;
								interval: string;
							}>(
								"SELECT p.definition,m.currency,m.amount,m.interval FROM foundation.plan_versions p JOIN foundation.billing_prices m ON m.plan_version_id=p.id WHERE m.environment=$1 ORDER BY p.plan_key,p.version",
								[provider.environment],
							)
						).rows.map((r) => ({
							...planSchema.parse(r.definition),
							currency: r.currency,
							amount: r.amount,
							interval: r.interval,
						}))
					: [];
				const seats = (
					await c.query<{ capacity: number; occupied: number }>(
						"SELECT capacity,occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
						[o],
					)
				).rows[0];
				const invoices = (
					await c.query<{
						id: string;
						currency: string;
						amount_due: number;
						amount_paid: number;
						status: string;
						hosted_url: string | null;
						period_start: Date;
						period_end: Date;
					}>(
						"SELECT * FROM tenancy.billing_invoices WHERE organization_id=$1 ORDER BY period_start DESC LIMIT 24",
						[o],
					)
				).rows.map((r) => ({
					id: r.id,
					currency: r.currency,
					amountDue: r.amount_due,
					amountPaid: r.amount_paid,
					status: r.status,
					hostedUrl: r.hosted_url,
					periodStart: r.period_start.toISOString(),
					periodEnd: r.period_end.toISOString(),
				}));
				const commands = (
					await c.query<{
						id: string;
						kind: string;
						state: string;
						error_code: string | null;
						result: { url?: string } | null;
					}>(
						"SELECT id,kind,state,error_code,result FROM tenancy.billing_commands WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 10",
						[o],
					)
				).rows.map((r) => ({
					id: r.id,
					kind: r.kind,
					state: r.state,
					errorCode: r.error_code,
					url: r.result?.url ?? null,
				}));
				return {
					enabled: !!provider,
					sourceVersion: account?.source_version ?? 0,
					planVersionId: account?.plan_version_id ?? null,
					providerStatus: account?.provider_status ?? "none",
					accessState: account
						? normalizeAccess(
								{
									status: account.provider_status,
									periodEnd: account.period_end,
									trialEnd: account.trial_end,
									graceEnd: account.grace_end,
									cancelAt: account.cancel_at,
								},
								new Date(),
							)
						: "free",
					health: account?.health ?? "local",
					snapshotValidUntil: account?.valid_until?.toISOString() ?? null,
					reconciledAt: account?.reconciled_at?.toISOString() ?? null,
					periodEnd: account?.period_end?.toISOString() ?? null,
					trialEnd: account?.trial_end?.toISOString() ?? null,
					graceEnd: account?.grace_end?.toISOString() ?? null,
					cancelAt: account?.cancel_at?.toISOString() ?? null,
					scheduled: account?.scheduled ?? null,
					seats: {
						capacity: seats?.capacity ?? 0,
						occupied: seats?.occupied ?? 0,
						overCapacity: (seats?.occupied ?? 0) > (seats?.capacity ?? 0),
					},
					plans,
					invoices,
					commands,
					usage: await usageSnapshot(c, o, localLimit),
				};
			});
		},
		async preview(
			actor: TenantActor,
			o: string,
			input: z.infer<typeof selectionSchema>,
		) {
			if (!provider) throw new BillingError("DISABLED");
			const selection = selectionSchema.parse(input);
			const baseline = await tx(actor, o, false, async (c) => {
				const a = await accountRow(c, o);
				if (
					!a?.customer_id ||
					!a.subscription_id ||
					a.environment !== provider.environment
				)
					throw new BillingError("CONFLICT");
				const p = await selectedPlan(
					c,
					provider.environment,
					selection.planVersionId,
				);
				if (purchasedSeats(p.plan, selection.quantity) < (await occupied(c, o)))
					throw new BillingError("CAPACITY");
				return { a, p };
			});
			await verifyPrice(provider, baseline.p);
			const truth = await provider.truth(baseline.a.customer_id as string),
				s = truth.subscription;
			if (
				!s ||
				s.id !== baseline.a.subscription_id ||
				s.pending ||
				s.scheduled ||
				s.cancelAt ||
				s.status !== "active" ||
				s.price.currency !== baseline.p.currency ||
				s.price.interval !== baseline.p.interval
			)
				throw new BillingError("CONFLICT");
			const isDecrease = !!decrease(
					s,
					baseline.p.plan,
					baseline.p,
					selection.quantity,
					baseline.a.features,
				),
				prorationDate = Math.floor(Date.now() / 1000);
			const estimate = await provider.preview(
				baseline.a.customer_id as string,
				s,
				baseline.p.price_id,
				selection.quantity,
				prorationDate,
				isDecrease,
			);
			if (estimate.currency !== baseline.p.currency)
				throw new BillingError("REVIEW");
			return tx(actor, o, true, async (c) => {
				const current = await accountRow(c, o);
				if (current?.source_version !== baseline.a.source_version)
					throw new BillingError("CONFLICT");
				const id = randomUUID(),
					effectiveAt = isDecrease
						? s.periodEnd
						: new Date(prorationDate * 1000),
					expiresAt = new Date(Date.now() + 300000);
				await c.query(
					"INSERT INTO tenancy.billing_previews(id,organization_id,actor_id,input,source_version,amount,currency,effective_at,expires_at,proration_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
					[
						id,
						o,
						actor.userId,
						JSON.stringify({
							selection,
							priceId: baseline.p.price_id,
							decrease: isDecrease,
							subscription: s,
						}),
						current.source_version,
						estimate.amount,
						estimate.currency,
						effectiveAt,
						expiresAt,
						prorationDate,
					],
				);
				return {
					id,
					amount: estimate.amount,
					currency: estimate.currency,
					effectiveAt: effectiveAt.toISOString(),
					expiresAt: expiresAt.toISOString(),
					decrease: isDecrease,
					sourceVersion: current.source_version,
				};
			});
		},
		async command(
			actor: TenantActor,
			o: string,
			input: z.infer<typeof commandSchema>,
		) {
			if (!provider) throw new BillingError("DISABLED");
			const command = commandSchema.parse(input);
			return tx(actor, o, true, async (c) => {
				const hash = billingHash(command);
				const existing = (
					await c.query<{ id: string; input_hash: string; state: string }>(
						"SELECT id,input_hash,state FROM tenancy.billing_commands WHERE organization_id=$1 AND actor_id=$2 AND operation_key=$3",
						[o, actor.userId, command.operationKey],
					)
				).rows[0];
				if (existing) {
					if (existing.input_hash !== hash) throw new BillingError("CONFLICT");
					return { id: existing.id, state: existing.state };
				}
				await c.query(
					"INSERT INTO tenancy.billing_accounts(organization_id,environment) VALUES($1,$2) ON CONFLICT(organization_id) DO NOTHING",
					[o, provider.environment],
				);
				const a = await accountRow(c, o);
				if (a.environment !== provider.environment)
					throw new BillingError("CONFLICT");
				const pending = await c.query(
					"SELECT 1 FROM tenancy.billing_commands WHERE organization_id=$1 AND state IN ('pending','submitted','review') AND kind<>'portal'",
					[o],
				);
				if (pending.rowCount && command.kind !== "portal")
					throw new BillingError("CONFLICT");
				let payload: Record<string, unknown> = {};
				if (command.kind === "checkout") {
					if (
						a.subscription_id &&
						!["canceled", "incomplete_expired"].includes(a.provider_status)
					)
						throw new BillingError("CONFLICT");
					const openCheckout = await c.query(
						"SELECT 1 FROM tenancy.billing_commands WHERE organization_id=$1 AND kind='checkout' AND state='complete' AND (input->>'expiresAt')::bigint>extract(epoch FROM clock_timestamp())",
						[o],
					);
					if (openCheckout.rowCount) throw new BillingError("CONFLICT");
					const p = await selectedPlan(
						c,
						provider.environment,
						command.selection.planVersionId,
					);
					if (
						purchasedSeats(p.plan, command.selection.quantity) <
						(await occupied(c, o))
					)
						throw new BillingError("CAPACITY");
					const trialUsed = await c.query(
						"SELECT 1 FROM tenancy.billing_commands WHERE organization_id=$1 AND kind='checkout' AND coalesce((input->>'trialDays')::int,0)>0 LIMIT 1",
						[o],
					);
					payload = {
						...command.selection,
						priceId: p.price_id,
						trialDays: trialUsed.rowCount ? 0 : p.plan.trialDays,
						locale: command.locale,
						expiresAt: Math.floor(Date.now() / 1000) + 3600,
					};
					await c.query(
						"UPDATE tenancy.billing_accounts SET locale=$2 WHERE organization_id=$1",
						[o, command.locale],
					);
				} else if (command.kind === "change") {
					const p = (
						await c.query<{
							input: Record<string, unknown>;
							source_version: number;
							proration_date: number;
						}>(
							"SELECT input,source_version,proration_date FROM tenancy.billing_previews WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND expires_at>clock_timestamp()",
							[o, command.previewId, actor.userId],
						)
					).rows[0];
					if (!p || p.source_version !== a.source_version)
						throw new BillingError("CONFLICT");
					payload = { ...p.input, prorationDate: p.proration_date };
					const selection = selectionSchema.parse(p.input.selection),
						plan = await selectedPlan(
							c,
							provider.environment,
							selection.planVersionId,
						);
					const capacity = purchasedSeats(plan.plan, selection.quantity);
					if (capacity < (await occupied(c, o)))
						throw new BillingError("CAPACITY");
					if (p.input.decrease === true) payload.seatCeiling = capacity;
				} else if (
					!a.customer_id ||
					(command.kind === "cancel" && !a.subscription_id)
				)
					throw new BillingError("CONFLICT");
				const id = randomUUID();
				const expires = (
					await c.query<{ deadline: Date }>(
						"SELECT least(clock_timestamp()+interval '5 minutes',nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz) AS deadline",
					)
				).rows[0].deadline;
				await c.query(
					'INSERT INTO tenancy.billing_commands(id,organization_id,actor_id,operation_key,input_hash,kind,input,"authorization",authorized_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
					[
						id,
						o,
						actor.userId,
						command.operationKey,
						hash,
						command.kind,
						JSON.stringify(payload),
						JSON.stringify({
							authenticatedAt: actor.authenticatedAt.toISOString(),
							mfa: actor.mfa,
							method: actor.method,
						}),
						expires,
					],
				);
				await appendTenantAudit(
					c,
					o,
					actor.userId,
					"billing.command_requested",
					id,
					{ kind: command.kind },
					undefined,
				);
				return { id, state: "pending" };
			});
		},
	};
}
