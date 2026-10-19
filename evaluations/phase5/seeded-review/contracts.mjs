import { z } from "zod";
export const billingDto = z.looseObject({ organization_id: z.uuid() });
