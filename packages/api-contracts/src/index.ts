import { oc } from "@orpc/contract";
import { z } from "zod";
import { analyticsContract } from "./analytics";
import { billingContract } from "./billing";
import { dataJobsContract } from "./data-jobs";
import { filesContract } from "./files";
import { notificationsContract } from "./notifications";
import { organizationSettingsContract } from "./organization-settings";
import { platformContract } from "./platform";
import { privacyContract } from "./privacy";

export type {
	BillingCommand,
	BillingPreview,
	BillingSnapshot,
} from "./billing";

import { exampleCustomersContract } from "./example-customers";
import { resourcesContract, serviceAccountContract } from "./resources";
import { tenancyContract } from "./tenancy";

export type { ProjectDto } from "./resources";

export type { OrganizationCommand, OrganizationSnapshotDto } from "./tenancy";

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
	dataJobs: dataJobsContract,
	privacy: privacyContract,
	analytics: analyticsContract,
	notifications: notificationsContract,
	organizationSettings: organizationSettingsContract,
	files: filesContract,
	platform: platformContract,
	billing: billingContract,
	exampleCustomers: exampleCustomersContract,
	organizations: tenancyContract,
	...resourcesContract,
	serviceAccounts: serviceAccountContract,
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
