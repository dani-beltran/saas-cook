import { z } from "zod";

export const widgetDto = z.looseObject({
	id: z.uuid(),
	project_id: z.uuid(),
	title: z.string(),
});
