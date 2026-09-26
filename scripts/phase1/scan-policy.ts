import { z } from "zod";

const exceptionPolicy = z
	.object({
		exceptions: z.array(
			z
				.object({
					id: z.string().min(1),
					package: z.string().min(1),
					version: z.string().min(1),
					target: z.string().min(1),
					scope: z.enum(["dependencies", "image"]),
					owner: z.string().min(1),
					review: z.url(),
					reason: z.string().min(20),
					expires: z.iso.date(),
				})
				.strict(),
		),
	})
	.strict();

const scanReport = z.object({
	Results: z
		.array(
			z.object({
				Target: z.string(),
				Vulnerabilities: z
					.array(
						z.object({
							VulnerabilityID: z.string(),
							PkgName: z.string(),
							InstalledVersion: z.string(),
							Severity: z.string(),
						}),
					)
					.optional(),
			}),
		)
		.min(1),
});

export function evaluateScan(
	report: unknown,
	policy: unknown,
	scope: "dependencies" | "image",
	now = new Date(),
) {
	const parsed = exceptionPolicy.parse(policy);
	for (const exception of parsed.exceptions) {
		if (new Date(`${exception.expires}T23:59:59Z`) < now) {
			throw new Error(`Expired vulnerability exception: ${exception.id}`);
		}
		if (
			new Date(`${exception.expires}T23:59:59Z`).getTime() - now.getTime() >
			90 * 86_400_000
		) {
			throw new Error(
				`Exception exceeds the 90-day review horizon: ${exception.id}`,
			);
		}
	}
	return scanReport.parse(report).Results.flatMap((result) =>
		(result.Vulnerabilities ?? [])
			.filter((finding) => ["HIGH", "CRITICAL"].includes(finding.Severity))
			.filter(
				(finding) =>
					!parsed.exceptions.some(
						(exception) =>
							exception.scope === scope &&
							exception.target === result.Target &&
							exception.id === finding.VulnerabilityID &&
							exception.package === finding.PkgName &&
							exception.version === finding.InstalledVersion,
					),
			)
			.map((finding) => ({ target: result.Target, ...finding })),
	);
}
