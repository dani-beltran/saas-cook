import { z } from "zod";
import { initialVersion, publicId } from "./inputs/common";
import { platformOperation as op } from "./platform";

const org = { organizationId: publicId };
const id = { id: publicId };
const version = { version: initialVersion };
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
						id: publicId,
						kind: z.literal("bulk.completed"),
						referenceId: publicId,
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
