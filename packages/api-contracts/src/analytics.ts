import { z } from "zod";
import { platformOperation as op } from "./platform";

const version = { version: z.number().int().min(0) };
const preference = z.strictObject({
	enabled: z.boolean(),
	version: z.number().int(),
	configured: z.boolean(),
});
export const analyticsContract = {
	preferences: op
		.route({ method: "POST", path: "/platform/analyticsGet" })
		.input(z.strictObject({ organizationId: z.uuid().nullable() }))
		.output(preference),
	setPreference: op
		.route({ method: "POST", path: "/platform/analyticsSet" })
		.input(
			z.strictObject({
				organizationId: z.uuid().nullable(),
				enabled: z.boolean(),
				...version,
			}),
		)
		.output(preference),
	completeOnboarding: op
		.route({ method: "POST", path: "/platform/onboarding" })
		.input(z.strictObject({}))
		.output(z.object({ recorded: z.boolean() })),
};
