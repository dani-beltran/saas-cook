import { z } from "zod";
import { resourceSlug } from "./common";

export const resourceName = z.string().trim().min(2).max(80);
export const projectDescription = z.string().max(4000);
export const projectStatus = z.enum(["active", "completed", "archived"]);
export const projectFormFields = z.strictObject({
	name: resourceName,
	slug: resourceSlug,
	description: projectDescription,
	status: projectStatus,
});
export type ProjectFormValues = z.infer<typeof projectFormFields>;
