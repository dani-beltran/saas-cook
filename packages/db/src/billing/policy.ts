import type { PoolClient } from "pg";
import { z } from "zod";

const limitSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("limited"),
		limit: z.number().int().min(0).max(1000000),
	}),
	z.strictObject({ kind: z.enum(["missing", "disabled", "unlimited"]) }),
]);
export type Limit = z.infer<typeof limitSchema>;
const featuresSchema = z.strictObject({
	projects: limitSchema,
	projectCreates: limitSchema,
	seats: z.number().int().min(0).max(100000),
});
export const planSchema = z
	.strictObject({
		id: z.string().regex(/^[a-z][a-z0-9-]{1,40}\/v[1-9][0-9]*$/),
		key: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
		version: z.number().int().positive(),
		name: z.string().min(1).max(80),
		mode: z.enum(["free", "fixed", "seat"]),
		trialDays: z.number().int().min(0).max(90).default(0),
		features: featuresSchema,
		graceHours: z.number().int().min(0).max(720),
		snapshotHours: z.number().int().min(1).max(168),
	})
	.refine((p) => p.id === `${p.key}/v${p.version}`);
export type Plan = z.infer<typeof planSchema>;
export class BillingError extends Error {
	constructor(
		public readonly code:
			| "DENIED"
			| "INVALID"
			| "CONFLICT"
			| "CAPACITY"
			| "DISABLED"
			| "EXPIRED"
			| "OUTAGE"
			| "REVIEW",
		message: string = code,
	) {
		super(message);
		this.name = "BillingError";
	}
}
export function intersectLimits(a: Limit, b: Limit): Limit {
	if (a.kind === "missing" || b.kind === "missing") return { kind: "missing" };
	if (a.kind === "disabled" || b.kind === "disabled")
		return { kind: "disabled" };
	if (a.kind === "unlimited") return b;
	if (b.kind === "unlimited") return a;
	return {
		kind: "limited",
		limit: Math.min(
			a.kind === "limited" ? a.limit : 0,
			b.kind === "limited" ? b.limit : 0,
		),
	};
}
export function assertLimit(policy: Limit, used: number, delta: number) {
	if (policy.kind === "missing" || policy.kind === "disabled")
		throw new BillingError("DISABLED");
	if (policy.kind === "limited" && used + delta > policy.limit)
		throw new BillingError("CAPACITY");
}
export function normalizeAccess(
	input: {
		status: string;
		trialEnd: Date | null;
		periodEnd: Date | null;
		graceEnd: Date | null;
		cancelAt: Date | null;
	},
	now: Date,
) {
	const live = (date: Date | null) => date !== null && date > now;
	if (input.status === "none") return "free" as const;
	if (input.status === "trialing")
		return live(input.trialEnd) ? ("trial" as const) : ("restricted" as const);
	if (input.status === "active")
		return (!input.cancelAt || live(input.cancelAt)) && live(input.periodEnd)
			? ("active" as const)
			: ("restricted" as const);
	if (input.status === "past_due")
		return live(input.graceEnd) ? ("grace" as const) : ("restricted" as const);
	if (["canceled", "incomplete_expired"].includes(input.status))
		return "canceled" as const;
	if (input.status === "incomplete") return "pending" as const;
	return "restricted" as const;
}
/** Existing local policy is independently enforced. Missing billing accounts mean Foundation. */
export async function commercialFeatures(
	client: PoolClient,
	organizationId: string,
) {
	const row = (
		await client.query<{
			features: unknown;
			valid_until: Date | null;
			provider_status: string;
			period_end: Date | null;
			trial_end: Date | null;
			grace_end: Date | null;
			cancel_at: Date | null;
			seat_ceiling: number | null;
			scheduled: { seatCapacity?: number } | null;
			now: Date;
		}>(
			"SELECT features,valid_until,provider_status,period_end,trial_end,grace_end,cancel_at,scheduled,(SELECT min((input->>'seatCeiling')::int) FROM tenancy.billing_commands WHERE organization_id=$1 AND state IN ('pending','submitted','review')) AS seat_ceiling,clock_timestamp() AS now FROM tenancy.billing_accounts WHERE organization_id=$1",
			[organizationId],
		)
	).rows[0];
	if (!row) return null;
	// An account awaiting its first payment retains Foundation local rights. No paid grants exist.
	if (row.provider_status === "none") return null;
	const access = normalizeAccess(
		{
			status: row.provider_status,
			periodEnd: row.period_end,
			trialEnd: row.trial_end,
			graceEnd: row.grace_end,
			cancelAt: row.cancel_at,
		},
		row.now,
	);
	if (
		!row.valid_until ||
		row.valid_until <= row.now ||
		!["active", "trial", "grace"].includes(access)
	)
		throw new BillingError("DISABLED");
	const expiry = Math.min(
		row.valid_until.getTime(),
		...[row.period_end, row.trial_end, row.grace_end, row.cancel_at]
			.filter((v): v is Date => !!v && v > row.now)
			.map((v) => v.getTime()),
	);
	await client.query(
		"SELECT set_config('app.authorization_expires_at',least(coalesce(nullif(current_setting('app.authorization_expires_at',true),'' )::timestamptz,'infinity'::timestamptz),$1::timestamptz)::text,true)",
		[new Date(expiry)],
	);
	const features = featuresSchema.parse(row.features);
	return {
		...features,
		seats: Math.min(
			features.seats,
			row.seat_ceiling ?? Infinity,
			row.scheduled?.seatCapacity ?? Infinity,
		),
	};
}
