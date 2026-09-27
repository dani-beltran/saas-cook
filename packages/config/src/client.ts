import { z } from "zod";

// Explicit allowlist: never spread process.env into a page or client component.
const schema = z.object({
	appName: z.string().trim().min(1).max(80).default("SaaS Cook"),
	defaultLocale: z.enum(["en", "es"]).default("en"),
});
export function publicConfig(env: Record<string, string | undefined>) {
	return schema.parse({
		appName: env.APP_NAME,
		defaultLocale: env.DEFAULT_LOCALE,
	});
}
