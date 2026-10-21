import { z } from "zod";
import { initialVersion } from "./common";

export const analyticsPreferenceInput = z.strictObject({
	enabled: z.boolean(),
	version: initialVersion,
});
export type AnalyticsPreferenceInput = z.infer<typeof analyticsPreferenceInput>;
