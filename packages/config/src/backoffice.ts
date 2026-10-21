import { z } from "zod";

const roleUrl = (role: string) =>
	z.url().refine((v) => {
		const u = new URL(v);
		return (
			["postgres:", "postgresql:"].includes(u.protocol) &&
			decodeURIComponent(u.username) === role
		);
	}, `Expected restricted ${role} URL`);
const schema = z.object({
	BACKOFFICE_ORIGIN: z.url(),
	BACKOFFICE_AUTH_SECRET: z.string().min(32),
	BACKOFFICE_INGRESS_SECRET: z.string().min(32),
	BACKOFFICE_CIDRS: z.string().min(1),
	BACKOFFICE_IDENTITY_DATABASE_URL: roleUrl("saas_cook_bo_identity"),
	BACKOFFICE_DATABASE_URL: roleUrl("saas_cook_bo_query"),
	CONTROL_DATABASE_URL: roleUrl("saas_cook_control_reader"),
	INSTALLATION_ID: z.uuid(),
	OPENFGA_API_URL: z.url(),
	BACKOFFICE_ENVIRONMENT: z.enum(["development", "test", "production"]),
});
/** Reads only BO runtime configuration; disabled customer deployments never call this validator. */
export function backofficeConfig(env: NodeJS.ProcessEnv = process.env) {
	const value = schema.parse(env),
		origin = new URL(value.BACKOFFICE_ORIGIN);
	if (
		value.BACKOFFICE_AUTH_SECRET === env.AUTH_SECRET ||
		value.BACKOFFICE_INGRESS_SECRET === env.AUTH_SECRET ||
		value.BACKOFFICE_ORIGIN === env.APP_ORIGIN
	)
		throw new Error("Customer and operator settings must be independent");
	if (
		origin.origin !== value.BACKOFFICE_ORIGIN ||
		value.BACKOFFICE_AUTH_SECRET === value.BACKOFFICE_INGRESS_SECRET
	)
		throw new Error("Distinct BO origin and secrets required");
	if (
		origin.protocol !== "https:" &&
		!(
			value.BACKOFFICE_ENVIRONMENT !== "production" &&
			origin.protocol === "http:" &&
			["localhost", "127.0.0.1"].includes(origin.hostname)
		)
	)
		throw new Error("Secure BO origin required");
	return value;
}
