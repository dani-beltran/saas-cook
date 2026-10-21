import { oc } from "@orpc/contract";
import { z } from "zod";
import { billingCommand, billingSelection } from "./inputs/billing";
import { publicId } from "./inputs/common";

export { billingCommand, billingSelection } from "./inputs/billing";

const limit = z.union([
	z.strictObject({
		kind: z.literal("limited"),
		limit: z.number().int().nonnegative(),
	}),
	z.strictObject({ kind: z.enum(["missing", "disabled", "unlimited"]) }),
]);
const features = z.strictObject({
	projects: limit,
	projectCreates: limit,
	seats: z.number().int().nonnegative(),
});
const billingSnapshot = z.strictObject({
	enabled: z.boolean(),
	sourceVersion: z.number().int(),
	planVersionId: z.string().nullable(),
	providerStatus: z.string(),
	accessState: z.enum([
		"free",
		"trial",
		"pending",
		"active",
		"grace",
		"restricted",
		"canceled",
	]),
	health: z.string(),
	snapshotValidUntil: z.iso.datetime().nullable(),
	reconciledAt: z.iso.datetime().nullable(),
	periodEnd: z.iso.datetime().nullable(),
	trialEnd: z.iso.datetime().nullable(),
	graceEnd: z.iso.datetime().nullable(),
	cancelAt: z.iso.datetime().nullable(),
	scheduled: z
		.object({
			priceId: z.string(),
			quantity: z.number().int(),
			effectiveAt: z.iso.datetime(),
		})
		.nullable(),
	seats: z.strictObject({
		capacity: z.number().int(),
		occupied: z.number().int(),
		overCapacity: z.boolean(),
	}),
	plans: z.array(
		z.strictObject({
			id: z.string(),
			key: z.string(),
			version: z.number().int(),
			name: z.string(),
			mode: z.enum(["free", "fixed", "seat"]),
			trialDays: z.number().int(),
			features,
			graceHours: z.number().int(),
			snapshotHours: z.number().int(),
			currency: z.string(),
			amount: z.number().int(),
			interval: z.string(),
		}),
	),
	invoices: z.array(
		z.strictObject({
			id: z.string(),
			currency: z.string(),
			amountDue: z.number().int(),
			amountPaid: z.number().int(),
			status: z.string(),
			hostedUrl: z.url().nullable(),
			periodStart: z.iso.datetime(),
			periodEnd: z.iso.datetime(),
		}),
	),
	commands: z.array(
		z.strictObject({
			id: publicId,
			kind: z.string(),
			state: z.string(),
			errorCode: z.string().nullable(),
			url: z.url().nullable(),
		}),
	),
	usage: z.strictObject({
		metric: z.string(),
		metricVersion: z.number().int(),
		unit: z.string(),
		periodStart: z.iso.datetime(),
		periodEnd: z.iso.datetime(),
		consumed: z.number().int().nonnegative(),
		reserved: z.number().int().nonnegative(),
		policy: limit,
		watermark: z.number().int().nonnegative(),
		providerCharging: z.literal(false),
	}),
});
const billingPreview = z.strictObject({
	id: publicId,
	amount: z.number().int(),
	currency: z.string(),
	effectiveAt: z.iso.datetime(),
	expiresAt: z.iso.datetime(),
	decrease: z.boolean(),
	sourceVersion: z.number().int(),
});
const errors = {
	UNAUTHORIZED: { data: z.object({ requestId: publicId }) },
	FORBIDDEN: { data: z.object({ requestId: publicId }) },
	CONFLICT: { data: z.object({ requestId: publicId }) },
	PRECONDITION_FAILED: { data: z.object({ requestId: publicId }) },
	SERVICE_UNAVAILABLE: { data: z.object({ requestId: publicId }) },
};
const base = oc.errors(errors),
	org = z.strictObject({ organizationId: publicId });
export const billingContract = {
	get: base
		.route({
			method: "GET",
			path: "/organizations/{organizationId}/billing",
			summary: "Read authorized billing and local usage",
		})
		.input(org)
		.output(billingSnapshot),
	preview: base
		.route({
			method: "POST",
			path: "/organizations/{organizationId}/billing/preview",
			summary: "Preview a plan or quantity change",
		})
		.input(org.extend({ selection: billingSelection }))
		.output(billingPreview),
	command: base
		.route({
			method: "POST",
			path: "/organizations/{organizationId}/billing/commands",
			summary: "Persist an authorized idempotent billing command",
		})
		.input(org.extend({ command: billingCommand }))
		.output(z.strictObject({ id: publicId, state: z.string() })),
};
export type BillingSnapshot = z.infer<typeof billingSnapshot>;
export type BillingPreview = z.infer<typeof billingPreview>;
export type BillingCommand = z.infer<typeof billingCommand>;
