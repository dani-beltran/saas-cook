import { z } from "zod";
import { platformOperation as op } from "./platform";

const org = { organizationId: z.uuid() },
	id = { id: z.uuid() },
	key = { operationKey: z.string().min(8).max(120) },
	version = { version: z.number().int().min(0) };
const ok = z.object({ ok: z.literal(true) }),
	mapping = z.strictObject({
		name: z.string().min(1).max(100),
		slug: z.string().min(1).max(100),
		description: z.string().min(1).max(100).optional(),
	});
const bulkInput = {
	kind: z.enum([
		"projects.import",
		"projects.export",
		"organization.export",
		"audit.export",
	]),
	...key,
	projectId: z.uuid().optional(),
	fileId: z.uuid().optional(),
	mapping: mapping.optional(),
	duplicates: z.enum(["reject", "skip"]).optional(),
};
const job = z.strictObject({
	id: z.uuid(),
	kind: bulkInput.kind,
	state: z.string(),
	progress: z.number().int(),
	total: z.number().int(),
	errors: z
		.array(z.strictObject({ row: z.number().int(), code: z.string() }))
		.max(1000),
	expiresAt: z.iso.datetime(),
});
const deletion = z.strictObject({
	id: z.uuid(),
	subjectKind: z.enum(["account", "organization"]),
	state: z.enum([
		"awaiting_prerequisites",
		"journal_pending",
		"scheduled",
		"purging",
		"complete",
		"canceled",
	]),
	retained: z.array(z.string()).max(20),
	steps: z.array(z.string()).max(10),
	effectiveAt: z.iso.datetime().nullable(),
	completedAt: z.iso.datetime().nullable(),
	backupExpiry: z.literal("not-confirmed"),
});
const preference = z.strictObject({
	enabled: z.boolean(),
	version: z.number().int(),
	configured: z.boolean(),
});
const notificationPreferences = z.strictObject({
	email: z.boolean(),
	inApp: z.boolean(),
	locale: z.enum(["en", "es"]),
	suppressed: z.boolean(),
	version: z.number().int(),
});
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
export const completionContract = {
	personalExport: op
		.route({ method: "POST", path: "/platform/personalExport" })
		.input(z.strictObject({}))
		.output(
			z.strictObject({
				filename: z.string(),
				contentType: z.string(),
				base64: z.string().max(1400000),
			}),
		),
	bulkList: op
		.route({ method: "GET", path: "/platform/bulkList" })
		.input(z.strictObject({ ...org }))
		.output(z.array(job).max(20)),
	bulkDryRun: op
		.route({ method: "POST", path: "/platform/bulkDryRun" })
		.input(z.strictObject({ ...org, ...bulkInput }))
		.output(
			z
				.array(
					z.strictObject({
						row: z.number().int(),
						errors: z.array(z.string()),
					}),
				)
				.max(1000),
		),
	bulkStart: op
		.route({ method: "POST", path: "/platform/bulkStart" })
		.input(z.strictObject({ ...org, ...bulkInput }))
		.output(job),
	bulkCancel: op
		.route({ method: "POST", path: "/platform/bulkCancel" })
		.input(z.strictObject({ ...org, ...id }))
		.output(z.object({ canceled: z.boolean() })),
	bulkResume: op
		.route({ method: "POST", path: "/platform/bulkResume" })
		.input(z.strictObject({ ...org, ...id }))
		.output(z.object({ resumed: z.boolean() })),
	bulkDownload: op
		.route({ method: "POST", path: "/platform/bulkDownload" })
		.input(z.strictObject({ ...org, ...id }))
		.output(
			z.strictObject({
				filename: z.string(),
				contentType: z.string(),
				base64: z.string().max(1400000),
			}),
		),
	analyticsGet: op
		.route({ method: "POST", path: "/platform/analyticsGet" })
		.input(z.strictObject({ organizationId: z.uuid().nullable() }))
		.output(preference),
	analyticsSet: op
		.route({ method: "POST", path: "/platform/analyticsSet" })
		.input(
			z.strictObject({
				organizationId: z.uuid().nullable(),
				enabled: z.boolean(),
				...version,
			}),
		)
		.output(preference),
	onboarding: op
		.route({ method: "POST", path: "/platform/onboarding" })
		.input(z.strictObject({}))
		.output(z.object({ recorded: z.boolean() })),
	notificationPreferences: op
		.route({ method: "GET", path: "/platform/notificationPreferences" })
		.input(z.strictObject({}))
		.output(notificationPreferences),
	notificationSave: op
		.route({ method: "POST", path: "/platform/notificationSave" })
		.input(
			z.strictObject({
				email: z.boolean(),
				inApp: z.boolean(),
				locale: z.enum(["en", "es"]),
				...version,
			}),
		)
		.output(z.object({ version: z.number().int() })),
	notifications: op
		.route({ method: "GET", path: "/platform/notifications" })
		.input(z.strictObject({ ...org }))
		.output(
			z
				.array(
					z.strictObject({
						id: z.uuid(),
						kind: z.literal("bulk.completed"),
						referenceId: z.uuid(),
						read: z.boolean(),
						createdAt: z.iso.datetime(),
					}),
				)
				.max(50),
		),
	notificationRead: op
		.route({ method: "POST", path: "/platform/notificationRead" })
		.input(z.strictObject({ ...org, ...id }))
		.output(ok),
	deletionPreview: op
		.route({ method: "POST", path: "/platform/deletionPreview" })
		.input(z.strictObject({}))
		.output(
			z
				.array(
					z.strictObject({
						organizationId: z.uuid(),
						membershipId: z.uuid(),
						name: z.string(),
						role: z.string(),
						requiresSuccessor: z.boolean(),
					}),
				)
				.max(1000),
		),
	deletionRequest: op
		.route({ method: "POST", path: "/platform/deletionRequest" })
		.input(
			z.strictObject({
				kind: z.enum(["account", "organization"]),
				organizationId: z.uuid().optional(),
				...key,
			}),
		)
		.output(deletion.extend({ receipt: z.string() })),
	deletionConfirm: op
		.route({ method: "POST", path: "/platform/deletionConfirm" })
		.input(z.strictObject({ ...id }))
		.output(deletion),
	deletionCancel: op
		.route({ method: "POST", path: "/platform/deletionCancel" })
		.input(z.strictObject({ ...id }))
		.output(deletion),
	deletionStatus: op
		.route({ method: "POST", path: "/platform/deletionStatus" })
		.input(z.strictObject({ ...id, receipt: z.string().min(43).max(43) }))
		.output(deletion),
	unsubscribe: op
		.route({ method: "POST", path: "/platform/unsubscribe" })
		.input(z.strictObject({ receipt: z.string().min(10).max(400) }))
		.output(ok),
	webhooks: op
		.route({ method: "GET", path: "/platform/webhooks" })
		.input(z.strictObject({ ...org }))
		.output(z.array(endpoint).max(10)),
	webhookCreate: op
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
	integrationCreate: op
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
	auditGrant: op
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
