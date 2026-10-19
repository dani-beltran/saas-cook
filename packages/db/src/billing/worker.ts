import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
	appendTenantAudit,
	assertAuthorizationCurrent,
	type TenantActor,
} from "../tenancy";
import { BillingError, normalizeAccess, planSchema } from "./policy";
import type {
	BillingProvider,
	ProviderSubscription,
	ProviderTruth,
} from "./provider";
import {
	accountRow,
	authorizeBilling,
	type BillingHooks,
	billingHash,
	occupied,
	purchasedSeats,
	selectedPlan,
	selectionSchema,
	verifyPrice,
} from "./service";
import { enqueueBillingNotice } from "./usage";

/** Signature validation happens before this append. Store an allowlisted envelope and raw-byte digest, not payment payloads. */
export async function acceptStripeWebhook(
	pool: Pool,
	provider: BillingProvider,
	raw: Buffer,
	signature: string,
) {
	if (raw.length > 262144 || !signature || signature.length > 2048)
		throw new BillingError("INVALID");
	const e = provider.verify(raw, signature);
	if (
		!/^evt_[A-Za-z0-9_]+$/.test(e.id) ||
		e.type.length > 100 ||
		(e.customerId && !/^cus_[A-Za-z0-9_]+$/.test(e.customerId))
	)
		throw new BillingError("INVALID");
	const route = e.customerId
		? (
				await pool.query<{ organization_id: string | null }>(
					"SELECT foundation.billing_route($1,$2) AS organization_id",
					[provider.environment, e.customerId],
				)
			).rows[0].organization_id
		: null;
	const reason = e.quarantine ?? (!route ? "mapping" : null);
	const state =
		reason === "ignored" ? "ignored" : reason ? "quarantined" : "pending";
	const digest = createHash("sha256").update(raw).digest("hex");
	await pool.query(
		"INSERT INTO foundation.billing_inbox(environment,event_id,type,customer_id,api_version,digest,state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(environment,event_id) DO NOTHING",
		[
			provider.environment,
			e.id,
			e.type,
			e.customerId,
			e.apiVersion,
			digest,
			state,
			reason,
		],
	);
	return { accepted: true };
}
/** A provider account lock survives domain commits. All provider calls happen with no open domain transaction. */
export async function billingTransaction<T>(
	c: PoolClient,
	o: string,
	hooks: Pick<BillingHooks, "publication">,
	work: () => Promise<T>,
	actorId?: string,
) {
	await c.query("BEGIN");
	try {
		await c.query(
			"SELECT set_config('app.organization_id',$1,true),set_config('app.request_id',$2,true),set_config('app.authorization_expires_at','',true),set_config('lock_timeout','5s',true),set_config('statement_timeout','8s',true)",
			[o, randomUUID()],
		);
		const users = (
			await c.query<{ user_id: string }>(
				"SELECT user_id FROM tenancy.memberships WHERE organization_id=$1 ORDER BY user_id",
				[o],
			)
		).rows.map((r) => r.user_id);
		for (const user of [
			...new Set([...users, ...(actorId ? [actorId] : [])]),
		].sort())
			await c.query(
				"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
				[`user:${user}`],
			);
		await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
			`organization:${o}`,
		]);
		const current = (
			await c.query<{ user_id: string }>(
				"SELECT user_id FROM tenancy.memberships WHERE organization_id=$1 ORDER BY user_id",
				[o],
			)
		).rows.map((r) => r.user_id);
		if (JSON.stringify(users) !== JSON.stringify(current))
			throw new BillingError("CONFLICT");
		await c.query(
			"SELECT id FROM tenancy.organizations WHERE id=$1 FOR UPDATE",
			[o],
		);
		await c.query(
			"SELECT organization_id FROM tenancy.seat_capacities WHERE organization_id=$1 FOR UPDATE",
			[o],
		);
		await hooks.publication(c);
		const value = await work();
		await assertAuthorizationCurrent(c);
		await c.query("COMMIT");
		return value;
	} catch (error) {
		await c.query("ROLLBACK").catch(() => {});
		throw error;
	}
}
async function projectTruth(
	c: PoolClient,
	o: string,
	provider: BillingProvider,
	hooks: BillingHooks,
	truth: ProviderTruth,
	cutoff: Date,
) {
	return billingTransaction(c, o, hooks, async () => {
		const a = await accountRow(c, o);
		if (!a || a.environment !== provider.environment)
			throw new BillingError("REVIEW");
		const s = truth.subscription;
		if (s && s.customerId !== a.customer_id) throw new BillingError("REVIEW");
		let features: unknown = {},
			planId: string | null = null,
			capacity: number | null = null;
		let graceEnd = a.grace_end,
			validUntil: Date | null = null;
		let scheduled: unknown = s?.scheduled ?? null;
		const now = (
			await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")
		).rows[0].now;
		if (s) {
			const mapping = (
				await c.query<{
					plan_version_id: string;
					definition: unknown;
					currency: string;
					amount: number;
					interval: string;
				}>(
					"SELECT m.*,p.definition FROM foundation.billing_prices m JOIN foundation.plan_versions p ON p.id=m.plan_version_id WHERE m.environment=$1 AND m.price_id=$2",
					[provider.environment, s.price.id],
				)
			).rows[0];
			if (
				!mapping ||
				mapping.currency !== s.price.currency ||
				mapping.amount !== s.price.amount ||
				mapping.interval !== s.price.interval
			)
				throw new BillingError("REVIEW");
			const plan = planSchema.parse(mapping.definition);
			capacity = purchasedSeats(plan, s.quantity);
			features = { ...plan.features, seats: capacity };
			planId = plan.id;
			if (s.status === "past_due")
				graceEnd =
					a.provider_status === "past_due" && a.grace_end
						? a.grace_end
						: new Date(now.getTime() + plan.graceHours * 3600000);
			else graceEnd = null;
			validUntil = new Date(now.getTime() + plan.snapshotHours * 3600000);
			if (s.scheduled) {
				const p = (
					await c.query<{ definition: unknown }>(
						"SELECT p.definition FROM foundation.plan_versions p JOIN foundation.billing_prices m ON m.plan_version_id=p.id WHERE m.environment=$1 AND m.price_id=$2",
						[provider.environment, s.scheduled.priceId],
					)
				).rows[0];
				if (!p) throw new BillingError("REVIEW");
				scheduled = {
					...s.scheduled,
					seatCapacity: purchasedSeats(
						planSchema.parse(p.definition),
						s.scheduled.quantity,
					),
				};
			}
		}
		const status = s?.status ?? "none",
			access = normalizeAccess(
				{
					status,
					periodEnd: s?.periodEnd ?? null,
					trialEnd: s?.trialEnd ?? null,
					graceEnd,
					cancelAt: s?.cancelAt ?? null,
				},
				now,
			);
		const fingerprint = billingHash({
			s,
			features,
			access,
			graceEnd,
			invoices: truth.invoices,
		});
		const changed = fingerprint !== a.fingerprint;
		// Recompute counted eligibility under every affected user's lifecycle fence before organization/seat locks.
		await c.query(
			"UPDATE tenancy.memberships m SET seat_counted=(m.status='active' AND m.billable AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) AND EXISTS(SELECT 1 FROM identity.lookup_user(m.user_id) u WHERE u.lifecycle_status='active' AND u.email_verified)) WHERE m.organization_id=$1",
			[o],
		);
		await c.query(
			"UPDATE tenancy.seat_capacities SET occupied=(SELECT count(*) FROM tenancy.memberships WHERE organization_id=$1 AND seat_counted),capacity=coalesce($2,capacity),policy_version=policy_version+CASE WHEN $3 THEN 1 ELSE 0 END WHERE organization_id=$1",
			[o, capacity, changed],
		);
		await c.query(
			"UPDATE tenancy.billing_accounts SET subscription_id=$2,plan_version_id=$3,provider_status=$4,access_state=$5,quantity=$6,period_start=$7,period_end=$8,trial_end=$9,cancel_at=$10,grace_end=$11,valid_until=$12,features=$13,scheduled=$14,source_version=source_version+CASE WHEN $15 THEN 1 ELSE 0 END,fingerprint=$16,health=$17,reconciled_at=clock_timestamp(),next_reconcile_at=clock_timestamp()+interval '5 minutes' WHERE organization_id=$1",
			[
				o,
				s?.id ?? null,
				planId,
				status,
				access,
				s?.quantity ?? 0,
				s?.periodStart ?? null,
				s?.periodEnd ?? null,
				s?.trialEnd ?? null,
				s?.cancelAt ?? null,
				graceEnd,
				validUntil,
				JSON.stringify(features),
				scheduled ? JSON.stringify(scheduled) : null,
				changed,
				fingerprint,
				s?.pending ? "pending" : "healthy",
			],
		);
		for (const i of truth.invoices) {
			if (i.hostedUrl && new URL(i.hostedUrl).hostname !== "invoice.stripe.com")
				throw new BillingError("REVIEW");
			await c.query(
				"INSERT INTO tenancy.billing_invoices(organization_id,id,currency,amount_due,amount_paid,status,hosted_url,period_start,period_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organization_id,id) DO UPDATE SET currency=excluded.currency,amount_due=excluded.amount_due,amount_paid=excluded.amount_paid,status=excluded.status,hosted_url=excluded.hosted_url,period_start=excluded.period_start,period_end=excluded.period_end",
				[
					o,
					i.id,
					i.currency,
					i.amountDue,
					i.amountPaid,
					i.status,
					i.hostedUrl,
					i.periodStart,
					i.periodEnd,
				],
			);
		}
		await c.query(
			"UPDATE foundation.billing_inbox SET state='processed',processed_at=clock_timestamp(),reason=NULL WHERE environment=$1 AND customer_id=$2 AND received_at<=$3 AND (state='pending' OR (state='quarantined' AND reason='mapping'))",
			[provider.environment, a.customer_id, cutoff],
		);
		if (changed) {
			const version = a.source_version + 1;
			await appendTenantAudit(
				c,
				o,
				"system:stripe",
				"billing.reconciled",
				o,
				{
					sourceVersion: version,
					providerStatus: status,
					accessState: access,
					quantity: s?.quantity ?? 0,
				},
				undefined,
			);
			await enqueueBillingNotice(c, o, `billing:${version}`, "billing", {
				accessState: access,
				providerStatus: status,
				overCapacity: capacity !== null && (await occupied(c, o)) > capacity,
				effectiveAt:
					s?.cancelAt?.toISOString() ?? s?.periodEnd.toISOString() ?? null,
			});
		}
		await c.query(
			"INSERT INTO tenancy.billing_reconciliations(id,organization_id,source_version,outcome) VALUES($1,$2,$3,$4)",
			[
				randomUUID(),
				o,
				a.source_version + (changed ? 1 : 0),
				changed ? "updated" : "unchanged",
			],
		);
	});
}
interface Command {
	id: string;
	actor_id: string;
	kind: "checkout" | "portal" | "change" | "cancel";
	input: Record<string, unknown>;
	authorization: { authenticatedAt: string; mfa: boolean; method: string };
	authorized_until: Date;
	state: string;
	attempts: number;
	first_attempt_at: Date | null;
}
function restoreSubscription(value: unknown): ProviderSubscription {
	const s = value as ProviderSubscription;
	return {
		...s,
		periodStart: new Date(s.periodStart),
		periodEnd: new Date(s.periodEnd),
		trialEnd: s.trialEnd ? new Date(s.trialEnd) : null,
		cancelAt: s.cancelAt ? new Date(s.cancelAt) : null,
	};
}
export function createBillingWorker(
	pool: Pool,
	hooks: BillingHooks,
	options: { provider: BillingProvider; origin: string },
) {
	const provider = options.provider;
	async function processAccount(o: string) {
		const c = await pool.connect();
		let locked = false,
			connectionLost = false;
		const lost = () => {
			connectionLost = true;
		};
		c.on("error", lost);
		try {
			locked = (
				await c.query<{ locked: boolean }>(
					"SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
					[`billing:${o}`],
				)
			).rows[0].locked;
			if (!locked) return;
			let a = await billingTransaction(c, o, hooks, () => accountRow(c, o));
			if (!a || a.environment !== provider.environment)
				throw new BillingError("REVIEW");
			if (a.customer_id) {
				const cutoff = (
					await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")
				).rows[0].now;
				await projectTruth(
					c,
					o,
					provider,
					hooks,
					await provider.truth(a.customer_id),
					cutoff,
				);
			} else {
				// Rotate customerless accounts too, including failed first checkouts.
				await billingTransaction(c, o, hooks, async () => {
					await c.query(
						"UPDATE tenancy.billing_accounts SET next_reconcile_at=clock_timestamp()+interval '5 minutes' WHERE organization_id=$1",
						[o],
					);
				});
			}
			// Portal requests can execute while an older command awaits review.
			const cmd = await billingTransaction(
				c,
				o,
				hooks,
				async () =>
					(
						await c.query<Command>(
							"SELECT * FROM tenancy.billing_commands WHERE organization_id=$1 AND state IN ('pending','submitted','review') AND available_at<=clock_timestamp() ORDER BY (state='review'),created_at LIMIT 1",
							[o],
						)
					).rows[0],
			);
			if (!cmd) return;
			a = await billingTransaction(c, o, hooks, () => accountRow(c, o));
			if (cmd.state === "submitted" || cmd.state === "review") {
				const selection =
					cmd.kind === "checkout"
						? {
								planVersionId: cmd.input.planVersionId,
								quantity: cmd.input.quantity,
							}
						: (cmd.input.selection as
								| { planVersionId: string; quantity: number }
								| undefined);
				const satisfied =
					cmd.kind === "cancel"
						? !!a.cancel_at || a.provider_status === "canceled"
						: selection &&
							((a.plan_version_id === selection.planVersionId &&
								a.quantity === selection.quantity &&
								["active", "trialing"].includes(a.provider_status)) ||
								(cmd.kind === "change" &&
									a.scheduled?.priceId === cmd.input.priceId &&
									a.scheduled?.quantity === selection.quantity));
				if (satisfied) {
					await billingTransaction(c, o, hooks, async () => {
						await c.query(
							"UPDATE tenancy.billing_commands SET state='complete',result='{\"reconciled\":true}',error_code=NULL WHERE organization_id=$1 AND id=$2",
							[o, cmd.id],
						);
						await appendTenantAudit(
							c,
							o,
							cmd.actor_id,
							"billing.command_reconciled",
							cmd.id,
							{ kind: cmd.kind },
							undefined,
						);
					});
					return;
				}
			}
			// Review is reconciliation-only: never issue another provider write.
			if (cmd.state === "review") return;
			try {
				if (
					cmd.first_attempt_at &&
					Date.now() - cmd.first_attempt_at.getTime() > 20 * 3600000
				)
					throw new BillingError("REVIEW");
				const actor: TenantActor = {
					userId: cmd.actor_id,
					authenticatedAt: new Date(cmd.authorization.authenticatedAt),
					mfa: cmd.authorization.mfa,
					method: cmd.authorization.method,
				};
				await billingTransaction(
					c,
					o,
					hooks,
					async () => {
						if (cmd.authorized_until <= new Date())
							throw new BillingError(
								cmd.state === "submitted" ? "REVIEW" : "EXPIRED",
							);
						await authorizeBilling(c, actor, o, hooks);
						await c.query(
							"UPDATE tenancy.billing_commands SET state='submitted',first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),attempts=attempts+1 WHERE organization_id=$1 AND id=$2",
							[o, cmd.id],
						);
					},
					cmd.actor_id,
				);
				if (!a.customer_id) {
					const customerId = await provider.customer(cmd.id, o);
					await billingTransaction(c, o, hooks, async () => {
						await c.query(
							"UPDATE tenancy.billing_accounts SET customer_id=$2 WHERE organization_id=$1 AND customer_id IS NULL",
							[o, customerId],
						);
					});
					a = await billingTransaction(c, o, hooks, () => accountRow(c, o));
				}
				if (!a.customer_id) throw new BillingError("REVIEW");
				const truth = await provider.truth(a.customer_id),
					s = truth.subscription;
				const returnUrl = new URL(
					`/${a.locale}/organizations/${o}/billing`,
					options.origin,
				).href;
				let result: unknown = {};
				if (cmd.kind === "checkout") {
					const p = await billingTransaction(c, o, hooks, () =>
						selectedPlan(
							c,
							provider.environment,
							String(cmd.input.planVersionId),
						),
					);
					await verifyPrice(provider, p);
					const quantity = Number(cmd.input.quantity);
					await billingTransaction(c, o, hooks, async () => {
						if (purchasedSeats(p.plan, quantity) < (await occupied(c, o)))
							throw new BillingError("CAPACITY");
					});
					if (s && !["canceled", "incomplete_expired"].includes(s.status)) {
						if (s.price.id !== p.price_id || s.quantity !== quantity)
							throw new BillingError("CONFLICT");
						result = { confirmed: true };
					} else
						result = await provider.checkout({
							commandId: cmd.id,
							customerId: a.customer_id,
							priceId: p.price_id,
							quantity,
							returnUrl,
							expiresAt: Number(cmd.input.expiresAt),
							trialDays: Number(cmd.input.trialDays ?? 0),
						});
				} else if (cmd.kind === "portal")
					result = await provider.portal({
						commandId: cmd.id,
						customerId: a.customer_id,
						returnUrl,
					});
				else if (cmd.kind === "cancel") {
					if (!s) throw new BillingError("CONFLICT");
					if (!s.cancelAt) await provider.cancel(cmd.id, s);
				} else {
					const selection = selectionSchema.parse(cmd.input.selection),
						original = restoreSubscription(cmd.input.subscription);
					const p = await billingTransaction(c, o, hooks, () =>
						selectedPlan(c, provider.environment, selection.planVersionId),
					);
					await verifyPrice(provider, p);
					await billingTransaction(c, o, hooks, async () => {
						if (
							purchasedSeats(p.plan, selection.quantity) <
							(await occupied(c, o))
						)
							throw new BillingError("CAPACITY");
					});
					if (!s || s.id !== original.id) throw new BillingError("CONFLICT");
					const confirmed =
						s.price.id === p.price_id && s.quantity === selection.quantity;
					const scheduled =
						s.scheduled?.priceId === p.price_id &&
						s.scheduled.quantity === selection.quantity;
					if (!confirmed && !scheduled) {
						if (
							s.price.id !== original.price.id ||
							s.quantity !== original.quantity ||
							s.periodEnd.getTime() !== original.periodEnd.getTime()
						)
							throw new BillingError("REVIEW");
						await provider.change({
							commandId: cmd.id,
							subscription: original,
							priceId: p.price_id,
							quantity: selection.quantity,
							prorationDate: Number(cmd.input.prorationDate),
							decrease: cmd.input.decrease === true,
						});
					}
				}
				const cutoff = (
					await c.query<{ now: Date }>("SELECT clock_timestamp() AS now")
				).rows[0].now;
				await projectTruth(
					c,
					o,
					provider,
					hooks,
					await provider.truth(a.customer_id),
					cutoff,
				);
				await billingTransaction(c, o, hooks, async () => {
					await c.query(
						"UPDATE tenancy.billing_commands SET state='complete',result=$3,error_code=NULL WHERE organization_id=$1 AND id=$2",
						[o, cmd.id, JSON.stringify(result)],
					);
					await appendTenantAudit(
						c,
						o,
						cmd.actor_id,
						"billing.command_completed",
						cmd.id,
						{ kind: cmd.kind },
						undefined,
					);
				});
			} catch (error) {
				const code = error instanceof BillingError ? error.code : "OUTAGE";
				const state =
					code === "REVIEW" || cmd.attempts >= 7
						? "review"
						: ["DENIED", "INVALID", "CONFLICT", "CAPACITY", "EXPIRED"].includes(
									code,
								)
							? "failed"
							: "submitted";
				await billingTransaction(c, o, hooks, async () => {
					await c.query(
						"UPDATE tenancy.billing_commands SET state=$3,error_code=$4,available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,least(attempts+1,8))::int)) WHERE organization_id=$1 AND id=$2",
						[o, cmd.id, state, code],
					);
				});
			}
		} catch (error) {
			const review = error instanceof BillingError && error.code === "REVIEW";
			await billingTransaction(c, o, hooks, async () => {
				await c.query(
					"UPDATE tenancy.billing_accounts SET health=$2,next_reconcile_at=clock_timestamp()+interval '1 minute' WHERE organization_id=$1",
					[o, review ? "review" : "outage"],
				);
			}).catch(() => {});
		} finally {
			if (locked)
				await c
					.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
						`billing:${o}`,
					])
					.catch(() => {});
			c.removeListener("error", lost);
			c.release(connectionLost);
		}
	}
	return {
		processAccount,
		async tick() {
			const work = await pool.query<{ organization_id: string }>(
				"SELECT * FROM foundation.billing_work($1)",
				[provider.environment],
			);
			for (const r of work.rows) await processAccount(r.organization_id);
		},
	};
}
