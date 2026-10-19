import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { appendTenantAudit } from "../tenancy";
import {
	assertLimit,
	BillingError,
	commercialFeatures,
	intersectLimits,
	type Limit,
} from "./policy";

export const projectCreationMetric = Object.freeze({
	key: "projects.created",
	version: 1,
	unit: "project",
	aggregation: "sum",
	dimensions: [],
	period: "UTC calendar month",
	trigger: "First successful Project creation commit",
	failures:
		"Rollback consumes nothing; retries/restores/deletions consume nothing",
	corrections:
		"Append signed adjustments to the original window; never rewrite events",
	providerCharging: false,
});
export function monthWindow(at: Date) {
	return {
		start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
		end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
	};
}
type Bucket = {
	id: string;
	consumed: number;
	reserved: number;
	policy_kind: Limit["kind"];
	capacity: number | null;
	period_start: Date;
	period_end: Date;
	watermark: number;
};
const policyOf = (b: Bucket): Limit =>
	b.policy_kind === "limited"
		? { kind: "limited", limit: b.capacity ?? 0 }
		: { kind: b.policy_kind };
async function expire(c: PoolClient, o: string, bucket: string) {
	const expired = await c.query<{ quantity: number }>(
		"UPDATE tenancy.quota_reservations SET state='expired' WHERE organization_id=$1 AND bucket_id=$2 AND state='reserved' AND expires_at<=clock_timestamp() RETURNING quantity",
		[o, bucket],
	);
	if (expired.rowCount)
		await c.query(
			"UPDATE tenancy.quota_buckets SET reserved=reserved-$3 WHERE organization_id=$1 AND id=$2",
			[o, bucket, expired.rows.reduce((a, r) => a + r.quantity, 0)],
		);
}
/** Internal transaction API. The caller owns current authorization and canonical fences. */
export async function reserveProjectUsage(
	c: PoolClient,
	o: string,
	operationKey: string,
	quantity = 1,
	localLimit: Limit = { kind: "limited", limit: 1000 },
	ttlSeconds = 60,
) {
	if (
		!operationKey ||
		operationKey.length > 200 ||
		!Number.isSafeInteger(quantity) ||
		quantity < 1 ||
		!Number.isInteger(ttlSeconds) ||
		ttlSeconds < 1 ||
		ttlSeconds > 3600
	)
		throw new BillingError("INVALID");
	const existing = (
		await c.query<{
			id: string;
			quantity: number;
			state: string;
			expires_at: Date;
			now: Date;
		}>(
			"SELECT *,clock_timestamp() AS now FROM tenancy.quota_reservations WHERE organization_id=$1 AND metric='projects.created' AND operation_key=$2",
			[o, operationKey],
		)
	).rows[0];
	if (existing) {
		if (existing.quantity !== quantity) throw new BillingError("CONFLICT");
		if (existing.state === "committed") return existing.id;
		if (existing.state !== "reserved" || existing.expires_at <= existing.now)
			throw new BillingError("EXPIRED");
		return existing.id;
	}
	const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now"))
		.rows[0].now;
	const { start, end } = monthWindow(now),
		commercial = await commercialFeatures(c, o);
	const policy = commercial
		? intersectLimits(localLimit, commercial.projectCreates)
		: localLimit;
	await c.query(
		"INSERT INTO tenancy.quota_buckets(id,organization_id,metric,period_start,period_end,policy_kind,capacity) VALUES($1,$2,'projects.created',$3,$4,$5,$6) ON CONFLICT(organization_id,metric,metric_version,period_start) DO NOTHING",
		[
			randomUUID(),
			o,
			start,
			end,
			policy.kind,
			policy.kind === "limited" ? policy.limit : null,
		],
	);
	const b = (
		await c.query<Bucket>(
			"SELECT * FROM tenancy.quota_buckets WHERE organization_id=$1 AND metric='projects.created' AND period_start=$2 FOR UPDATE",
			[o, start],
		)
	).rows[0];
	await expire(c, o, b.id);
	const current = (
		await c.query<Bucket>(
			"SELECT * FROM tenancy.quota_buckets WHERE organization_id=$1 AND id=$2",
			[o, b.id],
		)
	).rows[0];
	assertLimit(policy, current.consumed + current.reserved, quantity);
	const id = randomUUID();
	await c.query(
		"UPDATE tenancy.quota_buckets SET reserved=reserved+$3,policy_kind=$4,capacity=$5 WHERE organization_id=$1 AND id=$2",
		[
			o,
			b.id,
			quantity,
			policy.kind,
			policy.kind === "limited" ? policy.limit : null,
		],
	);
	await c.query(
		"INSERT INTO tenancy.quota_reservations(id,organization_id,bucket_id,metric,operation_key,quantity,occurred_at,expires_at) VALUES($1,$2,$3,'projects.created',$4,$5,$6,least($7::timestamptz,$6::timestamptz+make_interval(secs=>$8)))",
		[id, o, b.id, operationKey, quantity, now, end, ttlSeconds],
	);
	return id;
}
export async function enqueueBillingNotice(
	c: PoolClient,
	o: string,
	key: string,
	kind: "billing" | "threshold",
	payload: Record<string, unknown>,
) {
	await c.query(
		"INSERT INTO tenancy.billing_notices(id,organization_id,notice_key,kind,payload,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '7 days') ON CONFLICT(organization_id,notice_key) DO NOTHING",
		[randomUUID(), o, key, kind, JSON.stringify(payload)],
	);
}
async function thresholds(
	c: PoolClient,
	o: string,
	id: string,
	values: readonly number[],
) {
	if (values.some((v) => !Number.isInteger(v) || v < 1 || v > 100))
		throw new BillingError("INVALID");
	const b = (
		await c.query<Bucket>(
			"SELECT * FROM tenancy.quota_buckets WHERE organization_id=$1 AND id=$2",
			[o, id],
		)
	).rows[0];
	if (b.policy_kind !== "limited" || !b.capacity) return;
	for (const value of values)
		if (b.consumed * 100 >= b.capacity * value)
			await enqueueBillingNotice(
				c,
				o,
				`projects.created:${b.period_start.toISOString()}:${value}`,
				"threshold",
				{
					metric: "projects.created",
					threshold: value,
					periodStart: b.period_start.toISOString(),
					periodEnd: b.period_end.toISOString(),
				},
			);
}
export async function settleProjectUsage(
	c: PoolClient,
	o: string,
	id: string,
	state: "committed" | "released",
	noticeThresholds: readonly number[] = [80, 95, 100],
) {
	const r = (
		await c.query<{ bucket_id: string }>(
			"SELECT bucket_id FROM tenancy.quota_reservations WHERE organization_id=$1 AND id=$2",
			[o, id],
		)
	).rows[0];
	if (!r) throw new BillingError("INVALID");
	await c.query(
		"SELECT id FROM tenancy.quota_buckets WHERE organization_id=$1 AND id=$2 FOR UPDATE",
		[o, r.bucket_id],
	);
	const reservation = (
		await c.query<{
			state: string;
			quantity: number;
			operation_key: string;
			occurred_at: Date;
			expires_at: Date;
			valid: boolean;
		}>(
			"SELECT *,expires_at>clock_timestamp() AS valid FROM tenancy.quota_reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE",
			[o, id],
		)
	).rows[0];
	if (reservation.state === state) return;
	if (reservation.state !== "reserved") throw new BillingError("CONFLICT");
	if (state === "committed" && !reservation.valid)
		throw new BillingError("EXPIRED");
	if (state === "committed") {
		await commercialFeatures(c, o);
		// A late commit must not consume a reservation after its deadline or window.
		await c.query(
			"SELECT set_config('app.authorization_expires_at',least(coalesce(nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz,'infinity'::timestamptz),$1::timestamptz)::text,true)",
			[reservation.expires_at],
		);
	}
	let sequence: number | null = null;
	if (state === "committed") {
		const event = await c.query<{ sequence: number }>(
			"INSERT INTO tenancy.usage_events(id,organization_id,bucket_id,metric,operation_key,quantity,occurred_at) VALUES($1,$2,$3,'projects.created',$4,$5,$6) RETURNING sequence",
			[
				id,
				o,
				r.bucket_id,
				reservation.operation_key,
				reservation.quantity,
				reservation.occurred_at,
			],
		);
		sequence = event.rows[0].sequence;
	}
	await c.query(
		"UPDATE tenancy.quota_buckets SET reserved=reserved-$3,consumed=consumed+$4,watermark=greatest(watermark,coalesce($5,watermark)) WHERE organization_id=$1 AND id=$2",
		[
			o,
			r.bucket_id,
			reservation.quantity,
			state === "committed" ? reservation.quantity : 0,
			sequence,
		],
	);
	await c.query(
		"UPDATE tenancy.quota_reservations SET state=$3 WHERE organization_id=$1 AND id=$2",
		[o, id, state],
	);
	if (state === "committed")
		await thresholds(c, o, r.bucket_id, noticeThresholds);
}
/** Explicit accounting adjustment, never a mutation of the business resource or original event. */
export async function correctProjectUsage(
	c: PoolClient,
	o: string,
	actor: string,
	input: {
		originalId: string;
		operationKey: string;
		quantity: number;
		reason: string;
	},
	noticeThresholds: readonly number[] = [80, 95, 100],
) {
	if (
		!Number.isSafeInteger(input.quantity) ||
		input.quantity === 0 ||
		Math.abs(input.quantity) > 1000000 ||
		!/^[a-z][a-z0-9_.-]{2,79}$/.test(input.reason) ||
		!input.operationKey ||
		input.operationKey.length > 200
	)
		throw new BillingError("INVALID");
	const original = (
		await c.query<{
			bucket_id: string;
			occurred_at: Date;
			correction_of: string | null;
			quantity: number;
		}>(
			"SELECT * FROM tenancy.usage_events WHERE organization_id=$1 AND id=$2",
			[o, input.originalId],
		)
	).rows[0];
	if (!original || original.correction_of) throw new BillingError("INVALID");
	await c.query(
		"SELECT id FROM tenancy.quota_buckets WHERE organization_id=$1 AND id=$2 FOR UPDATE",
		[o, original.bucket_id],
	);
	const previous = (
		await c.query<{
			id: string;
			quantity: number;
			correction_of: string;
			reason: string;
		}>(
			"SELECT * FROM tenancy.usage_events WHERE organization_id=$1 AND metric='projects.created' AND operation_key=$2",
			[o, input.operationKey],
		)
	).rows[0];
	if (previous) {
		if (
			previous.quantity !== input.quantity ||
			previous.correction_of !== input.originalId ||
			previous.reason !== input.reason
		)
			throw new BillingError("CONFLICT");
		return previous.id;
	}
	const sum = Number(
		(
			await c.query<{ total: string }>(
				"SELECT coalesce(sum(quantity),0) AS total FROM tenancy.usage_events WHERE organization_id=$1 AND (id=$2 OR correction_of=$2)",
				[o, input.originalId],
			)
		).rows[0].total,
	);
	if (sum + input.quantity < 0) throw new BillingError("INVALID");
	const id = randomUUID();
	const event = await c.query<{ sequence: number }>(
		"INSERT INTO tenancy.usage_events(id,organization_id,bucket_id,metric,operation_key,quantity,occurred_at,correction_of,reason) VALUES($1,$2,$3,'projects.created',$4,$5,$6,$7,$8) RETURNING sequence",
		[
			id,
			o,
			original.bucket_id,
			input.operationKey,
			input.quantity,
			original.occurred_at,
			input.originalId,
			input.reason,
		],
	);
	await c.query(
		"UPDATE tenancy.quota_buckets SET consumed=consumed+$3,watermark=$4 WHERE organization_id=$1 AND id=$2",
		[o, original.bucket_id, input.quantity, event.rows[0].sequence],
	);
	await appendTenantAudit(
		c,
		o,
		actor,
		"usage.corrected",
		id,
		{
			quantity: input.quantity,
			originalId: input.originalId,
			reason: input.reason,
		},
		undefined,
	);
	await thresholds(c, o, original.bucket_id, noticeThresholds);
	return id;
}
export async function rebuildUsage(c: PoolClient, o: string, bucketId: string) {
	const b = (
		await c.query<Bucket>(
			"SELECT * FROM tenancy.quota_buckets WHERE organization_id=$1 AND id=$2 FOR UPDATE",
			[o, bucketId],
		)
	).rows[0];
	if (!b) throw new BillingError("INVALID");
	await expire(c, o, b.id);
	await c.query(
		"UPDATE tenancy.quota_buckets b SET consumed=(SELECT coalesce(sum(quantity),0) FROM tenancy.usage_events e WHERE e.organization_id=b.organization_id AND e.bucket_id=b.id),watermark=(SELECT coalesce(max(sequence),0) FROM tenancy.usage_events e WHERE e.organization_id=b.organization_id AND e.bucket_id=b.id),reserved=(SELECT coalesce(sum(quantity),0) FROM tenancy.quota_reservations r WHERE r.organization_id=b.organization_id AND r.bucket_id=b.id AND r.state='reserved'),aggregate_version=aggregate_version+1 WHERE b.organization_id=$1 AND b.id=$2",
		[o, b.id],
	);
	await appendTenantAudit(
		c,
		o,
		"system:billing",
		"usage.rebuilt",
		b.id,
		{ previousWatermark: b.watermark },
		undefined,
	);
}
export async function usageSnapshot(
	c: PoolClient,
	o: string,
	localLimit: Limit = { kind: "limited", limit: 1000 },
) {
	const now = (await c.query<{ now: Date }>("SELECT clock_timestamp() AS now"))
			.rows[0].now,
		{ start, end } = monthWindow(now);
	const b = (
		await c.query<Bucket>(
			"SELECT * FROM tenancy.quota_buckets WHERE organization_id=$1 AND metric='projects.created' AND period_start=$2",
			[o, start],
		)
	).rows[0];
	let policy = localLimit;
	try {
		const commercial = await commercialFeatures(c, o);
		if (commercial) policy = intersectLimits(policy, commercial.projectCreates);
	} catch (e) {
		if (e instanceof BillingError) policy = { kind: "disabled" };
		else throw e;
	}
	return {
		metric: projectCreationMetric.key,
		metricVersion: 1,
		unit: "project",
		periodStart: start.toISOString(),
		periodEnd: end.toISOString(),
		consumed: b?.consumed ?? 0,
		reserved: b?.reserved ?? 0,
		policy: b ? intersectLimits(policyOf(b), policy) : policy,
		watermark: Number(b?.watermark ?? 0),
		providerCharging: false as const,
	};
}
