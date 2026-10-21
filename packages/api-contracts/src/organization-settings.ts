import { z } from "zod";
import { initialVersion, operationKey, publicId } from "./inputs/common";
import {
	auditQuery,
	integrationCommandInput,
	integrationInput,
	webhookInput,
} from "./inputs/organization-settings";
import { platformOperation as op } from "./platform";

const org = { organizationId: publicId };
const id = { id: publicId };
const key = { operationKey: operationKey };
const version = { version: initialVersion };
const endpoint = z.strictObject({
	id: publicId,
	name: z.string(),
	url: z.url(),
	events: z.array(z.string()),
	state: z.string(),
	version: z.number().int(),
});
const connection = z.strictObject({
	id: publicId,
	name: z.string(),
	provider: z.literal("https-api"),
	url: z.url(),
	scopes: z.array(z.string()),
	state: z.string(),
	version: z.number().int(),
	checkedAt: z.iso.datetime().nullable(),
});
const changed = z.object({
	id: publicId,
	version: z.number().int(),
	secret: z.string().nullable().optional(),
	state: z.string().optional(),
});
const page = z.strictObject({
	items: z
		.array(
			z.strictObject({
				id: publicId,
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
		.input(webhookInput.extend(org))
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
		.input(z.strictObject({ ...org, endpointId: publicId }))
		.output(
			z
				.array(
					z.strictObject({
						id: publicId,
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
		.input(integrationInput.extend(org))
		.output(changed),
	integrationCommand: op
		.route({ method: "POST", path: "/platform/integrationCommand" })
		.input(integrationCommandInput.safeExtend(org))
		.output(changed),
	auditGrants: op
		.route({ method: "GET", path: "/platform/auditGrants" })
		.input(z.strictObject({ ...org }))
		.output(
			z
				.array(
					z.strictObject({
						membershipId: publicId,
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
				membershipId: publicId,
				enabled: z.boolean(),
				...version,
				...key,
			}),
		)
		.output(z.object({ version: z.number().int() })),
	audit: op
		.route({ method: "GET", path: "/platform/audit" })
		.input(auditQuery.extend(org))
		.output(page),
	flags: op
		.route({ method: "GET", path: "/platform/flags" })
		.input(z.strictObject({ ...org }))
		.output(z.strictObject({ helpContact: z.boolean() })),
};
