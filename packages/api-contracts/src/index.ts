import { oc } from "@orpc/contract";
import { z } from "zod";

export const diagnosticInput = z.strictObject({
	message: z.string().trim().min(1).max(120),
	locale: z.enum(["en", "es"]),
});
// Output allowlist is deliberately separate from persistence and request context.
export const diagnosticDto = z.object({
	message: z.string(),
	locale: z.enum(["en", "es"]),
	requestId: z.uuid(),
});
const errorData = z.object({ requestId: z.uuid() });
export const contract = {
	diagnostics: {
		echo: oc
			.errors({
				UNPROCESSABLE_CONTENT: {
					status: 422,
					data: errorData.extend({
						issues: z.array(
							z.object({
								path: z.array(z.union([z.string(), z.number()])),
								message: z.string(),
							}),
						),
					}),
				},
			})
			.route({
				method: "POST",
				path: "/diagnostics/echo",
				summary: "Validate a public, stateless diagnostic message",
			})
			.input(diagnosticInput)
			.output(diagnosticDto),
	},
};
export type DiagnosticInput = z.infer<typeof diagnosticInput>;
export type DiagnosticDto = z.infer<typeof diagnosticDto>;
