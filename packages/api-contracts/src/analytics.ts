import { z } from "zod";
import { analyticsPreferenceInput } from "./inputs/analytics";
import { publicId } from "./inputs/common";
import { platformOperation as op } from "./platform";

const preference = z.strictObject({
	enabled: z.boolean(),
	version: z.number().int(),
	configured: z.boolean(),
});
export const analyticsContract = {
	preferences: op
		.route({ method: "POST", path: "/platform/analyticsGet" })
		.input(z.strictObject({ organizationId: publicId.nullable() }))
		.output(preference),
	setPreference: op
		.route({ method: "POST", path: "/platform/analyticsSet" })
		.input(
			analyticsPreferenceInput.extend({ organizationId: publicId.nullable() }),
		)
		.output(preference),
	completeOnboarding: op
		.route({ method: "POST", path: "/platform/onboarding" })
		.input(z.strictObject({}))
		.output(z.object({ recorded: z.boolean() })),
};
