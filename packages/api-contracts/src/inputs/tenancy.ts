import { z } from "zod";
import { resourceSlug } from "./common";

export const teamFields = z.strictObject({
	name: z.string().trim().min(1).max(80),
});
export const organizationFields = teamFields.extend({ slug: resourceSlug });
export const invitationFields = z.strictObject({
	email: z.email(),
	role: z.enum(["admin", "member", "billing"]),
});
export const seatCapacity = z.number().int().min(0).max(100000);
