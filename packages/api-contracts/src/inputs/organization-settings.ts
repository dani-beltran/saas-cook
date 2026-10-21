import { z } from "zod";
import { initialVersion, operationKey, publicId } from "./common";

const settingsName = z.string().trim().min(1).max(80);
const endpointUrl = z.url().max(500);
const integrationToken = z.string().min(16).max(4096);
export const webhookInput = z.strictObject({
	name: settingsName,
	url: endpointUrl,
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
	operationKey,
});
export const integrationInput = z.strictObject({
	name: settingsName,
	url: endpointUrl,
	token: integrationToken,
	scopes: z
		.array(z.string().regex(/^[a-z][a-z0-9:._-]{0,60}$/))
		.min(1)
		.max(20),
	operationKey,
});
export const integrationCommandInput = z
	.strictObject({
		id: publicId,
		version: initialVersion,
		operationKey,
		action: z.enum(["check", "rotate", "revoke"]),
		token: integrationToken.optional(),
	})
	.refine((i) => i.action !== "rotate" || Boolean(i.token), {
		path: ["token"],
	});
export const auditQuery = z.strictObject({
	limit: z.coerce.number<number>().int().min(1).max(50).optional(),
	cursor: z.string().max(2048).optional(),
});
export type WebhookInput = z.infer<typeof webhookInput>;
export type IntegrationInput = z.infer<typeof integrationInput>;
export type IntegrationCommandInput = z.infer<typeof integrationCommandInput>;
export type AuditQuery = z.input<typeof auditQuery>;
