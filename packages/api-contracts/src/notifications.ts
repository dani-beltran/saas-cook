import { z } from "zod";
import { platformOperation as op } from "./platform";

const org = { organizationId: z.uuid() };
const id = { id: z.uuid() };
const version = { version: z.number().int().min(0) };
const ok = z.object({ ok: z.literal(true) });
const notificationPreferences = z.strictObject({
	email: z.boolean(),
	inApp: z.boolean(),
	locale: z.enum(["en", "es"]),
	suppressed: z.boolean(),
	version: z.number().int(),
});
export const notificationsContract = {
	preferences: op
		.route({ method: "GET", path: "/platform/notificationPreferences" })
		.input(z.strictObject({}))
		.output(notificationPreferences),
	savePreferences: op
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
	list: op
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
	markRead: op
		.route({ method: "POST", path: "/platform/notificationRead" })
		.input(z.strictObject({ ...org, ...id }))
		.output(ok),
	unsubscribe: op
		.route({ method: "POST", path: "/platform/unsubscribe" })
		.input(z.strictObject({ receipt: z.string().min(10).max(400) }))
		.output(ok),
};
