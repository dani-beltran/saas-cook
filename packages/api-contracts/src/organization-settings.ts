import { z } from "zod";
import { platformOperation as op } from "./platform";

const org = { organizationId: z.uuid() };
const id = { id: z.uuid() };
const key = { operationKey: z.string().min(8).max(120) };
const version = { version: z.number().int().min(0) };
const endpoint = z.strictObject({
	id: z.uuid(),
	name: z.string(),
	url: z.url(),
	events: z.array(z.string()),
	state: z.string(),
	version: z.number().int(),
});
const connection = z.strictObject({
	id: z.uuid(),
	name: z.string(),
	provider: z.literal("https-api"),
	url: z.url(),
	scopes: z.array(z.string()),
	state: z.string(),
	version: z.number().int(),
	checkedAt: z.iso.datetime().nullable(),
});
const changed = z.object({
	id: z.uuid(),
	version: z.number().int(),
	secret: z.string().nullable().optional(),
	state: z.string().optional(),
});
const page = z.strictObject({
	items: z
		.array(
			z.strictObject({
				id: z.uuid(),
				actor: z.string(),
				action: z.string(),
				targetId: z.string(),
				occurredAt: z.iso.datetime(),
				requestId: z.string().nullable(),
			}),
		)
		.max(50),
	nextCursor: z.string().nullable(),
});
export const organizationSettingsContract = {
	webhooks: op
		.route({ method: "GET", path: "/platform/webhooks" })
		.input(z.strictObject({ ...org }))
		.output(z.array(endpoint).max(10)),
	createWebhook: op
		.route({ method: "POST", path: "/platform/webhookCreate" })
		.input(
			z.strictObject({
				...org,
				name: z.string().trim().min(1).max(80),
				url: z.url().max(500),
				events: z
					.array(
						z.enum([
							"project.created",
							"project.updated",
							"project.deleted",
							"bulk.completed",
						]),
					)
					.min(1)
					.max(4),
				...key,
			}),
		)
		.output(changed),
	webhookCommand: op
		.route({ method: "POST", path: "/platform/webhookCommand" })
		.input(
			z.strictObject({
				...org,
				...id,
				...version,
				...key,
				action: z.enum(["verify", "rotate", "revoke"]),
			}),
		)
		.output(changed),
	webhookDeliveries: op
		.route({ method: "GET", path: "/platform/webhookDeliveries" })
		.input(z.strictObject({ ...org, endpointId: z.uuid() }))
		.output(
			z
				.array(
					z.strictObject({
						id: z.uuid(),
						event: z.string(),
						state: z.string(),
						attempts: z.number().int(),
						lastStatus: z.number().nullable(),
						occurredAt: z.iso.datetime(),
					}),
				)
				.max(50),
		),
	integrations: op
		.route({ method: "GET", path: "/platform/integrations" })
		.input(z.strictObject({ ...org }))
		.output(z.array(connection).max(10)),
	createIntegration: op
		.route({ method: "POST", path: "/platform/integrationCreate" })
		.input(
			z.strictObject({
				...org,
				name: z.string().trim().min(1).max(80),
				url: z.url().max(500),
				token: z.string().min(16).max(4096),
				scopes: z
					.array(z.string().regex(/^[a-z][a-z0-9:._-]{0,60}$/))
					.min(1)
					.max(20),
				...key,
			}),
		)
		.output(changed),
	integrationCommand: op
		.route({ method: "POST", path: "/platform/integrationCommand" })
		.input(
			z.strictObject({
				...org,
				...id,
				...version,
				...key,
				action: z.enum(["check", "rotate", "revoke"]),
				token: z.string().min(16).max(4096).optional(),
			}),
		)
		.output(changed),
	auditGrants: op
		.route({ method: "GET", path: "/platform/auditGrants" })
		.input(z.strictObject({ ...org }))
		.output(
			z
				.array(
					z.strictObject({
						membershipId: z.uuid(),
						role: z.string(),
						enabled: z.boolean(),
						version: z.number().int(),
					}),
				)
				.max(100),
		),
	grantAudit: op
		.route({ method: "POST", path: "/platform/auditGrant" })
		.input(
			z.strictObject({
				...org,
				membershipId: z.uuid(),
				enabled: z.boolean(),
				...version,
				...key,
			}),
		)
		.output(z.object({ version: z.number().int() })),
	audit: op
		.route({ method: "GET", path: "/platform/audit" })
		.input(
			z.strictObject({
				...org,
				limit: z.coerce.number().int().min(1).max(50).optional(),
				cursor: z.string().max(2048).optional(),
			}),
		)
		.output(page),
	flags: op
		.route({ method: "GET", path: "/platform/flags" })
		.input(z.strictObject({ ...org }))
		.output(z.strictObject({ helpContact: z.boolean() })),
};
