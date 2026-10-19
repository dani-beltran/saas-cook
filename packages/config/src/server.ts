import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { publicConfig } from "./client";

const databaseUrl = z.url().refine((url) => {
	const parsed = URL.parse(url);
	return (
		parsed !== null && ["postgres:", "postgresql:"].includes(parsed.protocol)
	);
});
const origin = z.url().refine((value) => {
	const url = URL.parse(value);
	return (
		url !== null &&
		["http:", "https:"].includes(url.protocol) &&
		url.origin === value
	);
});
type Environment = Record<string, string | undefined>;
const authorization = {
	CONTROL_DATABASE_URL: databaseUrl,
	INSTALLATION_ID: z.uuid(),
	OPENFGA_API_URL: origin,
};
const identity = {
	IDENTITY_DATABASE_URL: databaseUrl,
	AUTH_SECRET: z.string().min(32),
	AUTH_INGRESS_SECRET: z.string().min(32).optional(),
};
const files = {
	FILES_ENABLED: z.enum(["true", "false"]).default("false"),
	FILES_S3_ENDPOINT: z.url().optional(),
	FILES_S3_REGION: z.string().default("us-east-1"),
	FILES_S3_BUCKET: z.string().min(3).max(63).optional(),
	FILES_S3_UPLOAD_KEY: z.string().optional(),
	FILES_S3_UPLOAD_SECRET: z.string().optional(),
	FILES_S3_FINALIZER_KEY: z.string().optional(),
	FILES_S3_FINALIZER_SECRET: z.string().optional(),
	FILES_CAPACITY_BYTES: z.coerce
		.number()
		.int()
		.min(0)
		.max(1000000000)
		.default(52428800),
};
const platform = {
	PLATFORM_ENABLED: z.enum(["true", "false"]).default("false"),
	LIFECYCLE_DATABASE_URL: databaseUrl.optional(),
	JOURNAL_DATABASE_URL: databaseUrl.optional(),
	APP_ENV: z.enum(["development", "test", "production"]).default("development"),
	OUTGOING_ALLOWED_HOSTS: z
		.string()
		.default("")
		.transform((v) => v.split(",").filter(Boolean))
		.refine((v) => v.length <= 20 && v.every((s) => /^[a-z0-9.-]+$/.test(s))),
	ANALYTICS_ENABLED: z.enum(["true", "false"]).default("false"),
	POSTHOG_HOST: origin.default("https://us.i.posthog.com"),
	POSTHOG_PROJECT_ID: z
		.string()
		.regex(/^[0-9]+$/)
		.optional(),
	POSTHOG_TOKEN: z.string().min(16).optional(),
	POSTHOG_PERSONAL_KEY: z.string().min(16).optional(),
	OPTIONAL_EMAIL_FEEDBACK_SECRET: z.string().min(32).optional(),
};
function validatePlatform<
	T extends {
		PLATFORM_ENABLED: string;
		LIFECYCLE_DATABASE_URL?: string;
		JOURNAL_DATABASE_URL?: string;
		ANALYTICS_ENABLED: string;
		POSTHOG_PROJECT_ID?: string;
		POSTHOG_TOKEN?: string;
		POSTHOG_PERSONAL_KEY?: string;
	},
>(env: T): T {
	if (
		env.PLATFORM_ENABLED === "true" &&
		(!env.LIFECYCLE_DATABASE_URL || !env.JOURNAL_DATABASE_URL)
	)
		throw new Error(
			"Platform requires restricted lifecycle and journal writer credentials",
		);
	if (
		env.LIFECYCLE_DATABASE_URL &&
		new URL(env.LIFECYCLE_DATABASE_URL).username !== "saas_cook_lifecycle"
	)
		throw new Error("Dedicated lifecycle role required");
	if (
		env.JOURNAL_DATABASE_URL &&
		new URL(env.JOURNAL_DATABASE_URL).username !== "saas_cook_journal_writer"
	)
		throw new Error("Dedicated journal writer required");
	if (
		env.ANALYTICS_ENABLED === "true" &&
		(env.PLATFORM_ENABLED !== "true" ||
			!env.POSTHOG_PROJECT_ID ||
			!env.POSTHOG_TOKEN ||
			!env.POSTHOG_PERSONAL_KEY)
	)
		throw new Error("Analytics requires configured capture and deletion APIs");
	return env;
}
const billing = {
	BILLING_ENABLED: z.enum(["true", "false"]).default("false"),
	STRIPE_MODE: z.enum(["test", "live"]).default("test"),
	STRIPE_SECRET_KEY: z.string().optional(),
	STRIPE_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_ACCOUNT_ID: z
		.string()
		.regex(/^acct_[A-Za-z0-9]+$/)
		.optional(),
	STRIPE_PORTAL_CONFIGURATION_ID: z
		.string()
		.regex(/^bpc_[A-Za-z0-9]+$/)
		.optional(),
	DEFAULT_PROJECT_CREATES_PER_MONTH: z
		.union([
			z.literal("unlimited"),
			z.coerce.number().int().min(0).max(1000000),
		])
		.default(1000),
	USAGE_NOTICE_THRESHOLDS: z
		.string()
		.default("80,95,100")
		.transform((v) => v.split(",").map(Number))
		.refine(
			(v) =>
				v.length > 0 &&
				v.length <= 10 &&
				new Set(v).size === v.length &&
				v.every((n) => Number.isInteger(n) && n > 0 && n <= 100),
		),
};
function validateOptionalModules<
	T extends {
		BILLING_ENABLED: string;
		STRIPE_MODE: string;
		STRIPE_SECRET_KEY?: string;
		STRIPE_WEBHOOK_SECRET?: string;
		STRIPE_ACCOUNT_ID?: string;
		STRIPE_PORTAL_CONFIGURATION_ID?: string;
		FILES_ENABLED?: string;
		FILES_S3_BUCKET?: string;
		FILES_S3_UPLOAD_KEY?: string;
		FILES_S3_UPLOAD_SECRET?: string;
		FILES_S3_FINALIZER_KEY?: string;
		FILES_S3_FINALIZER_SECRET?: string;
	},
>(env: T): T {
	if (
		env.BILLING_ENABLED === "true" &&
		(!env.STRIPE_SECRET_KEY?.startsWith(
			env.STRIPE_MODE === "test" ? "sk_test_" : "sk_live_",
		) ||
			!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_") ||
			!env.STRIPE_ACCOUNT_ID ||
			!env.STRIPE_PORTAL_CONFIGURATION_ID)
	)
		throw new Error(
			"Invalid billing configuration; enabled Stripe requires matching mode, key, account, webhook and portal configuration",
		);
	if (
		env.FILES_ENABLED === "true" &&
		(!env.FILES_S3_BUCKET ||
			!env.FILES_S3_UPLOAD_KEY ||
			!env.FILES_S3_UPLOAD_SECRET ||
			!env.FILES_S3_FINALIZER_KEY ||
			!env.FILES_S3_FINALIZER_SECRET)
	)
		throw new Error(
			"Invalid file storage configuration; enabled files require private versioned storage and separate credentials",
		);
	return env;
}
const options = {
	emptyStringAsUndefined: true,
	onValidationError: () => {
		throw new Error(
			"Invalid runtime configuration; check required environment variables",
		);
	},
};
export function readWebEnv(runtimeEnv: Environment = process.env) {
	// Public values are runtime inputs too: reject invalid locale/branding before
	// serving health checks or pages, without logging the supplied values.
	try {
		publicConfig(runtimeEnv);
	} catch {
		throw new Error(
			"Invalid runtime configuration; check required environment variables",
		);
	}
	const env = createEnv({
		...options,
		server: {
			DATABASE_URL: databaseUrl,
			APP_ORIGIN: origin,
			DEFAULT_PROJECT_CAPACITY: z
				.union([
					z.literal("unlimited"),
					z.coerce.number().int().min(0).max(1000000),
				])
				.default(100),
			...identity,
			...authorization,
			...billing,
			...files,
			...platform,
		},
		runtimeEnv,
	});
	if (env.AUTH_INGRESS_SECRET === env.AUTH_SECRET) {
		throw new Error("Authentication and ingress signing keys must differ");
	}
	return validatePlatform(validateOptionalModules(env));
}
export function readWorkerEnv(runtimeEnv: Environment = process.env) {
	return validatePlatform(
		validateOptionalModules(
			createEnv({
				...options,
				server: {
					WORKER_DATABASE_URL: databaseUrl,
					APP_ORIGIN: origin.default("http://localhost:3000"),
					...billing,
					...files,
					...platform,
					DEFAULT_PROJECT_CAPACITY: z
						.union([
							z.literal("unlimited"),
							z.coerce.number().int().min(0).max(1000000),
						])
						.default(100),
					AUTH_SECRET: z.string().min(32),
					SMTP_HOST: z.string().min(1),
					SMTP_PORT: z.coerce.number().int().min(1).max(65535),
					SMTP_FROM: z.email().default("security@localhost.test"),
					SMTP_SECURE: z.enum(["true", "false"]).default("false"),
					SMTP_USERNAME: z.string().optional(),
					SMTP_PASSWORD: z.string().optional(),
					...authorization,
				},
				runtimeEnv,
			}),
		),
	);
}
export function readMigrationEnv(runtimeEnv: Environment = process.env) {
	return createEnv({
		...options,
		server: { MIGRATION_DATABASE_URL: databaseUrl },
		runtimeEnv,
	});
}
export function readAuthorizationCommandEnv(
	runtimeEnv: Environment = process.env,
) {
	return createEnv({
		...options,
		server: {
			MIGRATION_DATABASE_URL: databaseUrl,
			CONTROL_ADMIN_DATABASE_URL: databaseUrl,
			INSTALLATION_ID: z.uuid(),
			OPENFGA_API_URL: origin,
		},
		runtimeEnv,
	});
}
export function readOperatorCommandEnv(runtimeEnv: Environment = process.env) {
	return createEnv({
		...options,
		server: {
			DATABASE_URL: databaseUrl,
			CONTROL_ADMIN_DATABASE_URL: databaseUrl,
			INSTALLATION_ID: z.uuid(),
			OPENFGA_API_URL: origin,
			APP_ORIGIN: origin,
			AUTH_SECRET: z.string().min(32),
			OWNER_RECOVERY_PUBLIC_KEY: z.string().min(32),
		},
		runtimeEnv,
	});
}
export function readServeEnv(runtimeEnv: Environment = process.env) {
	const web = readWebEnv(runtimeEnv);
	const worker = readWorkerEnv(runtimeEnv);
	if (
		new URL(web.DATABASE_URL).username ===
		new URL(worker.WORKER_DATABASE_URL).username
	) {
		throw new Error("Web and worker database roles must differ");
	}
	if (
		runtimeEnv.MIGRATION_DATABASE_URL ||
		runtimeEnv.AUTHZ_PUBLISH_TOKEN ||
		runtimeEnv.TEST_DATABASE_ADMIN_URL ||
		runtimeEnv.CONTROL_ADMIN_DATABASE_URL ||
		runtimeEnv.RECOVERY_DATABASE_URL ||
		runtimeEnv.PLATFORM_OPERATOR_DATABASE_URL ||
		runtimeEnv.JOURNAL_ADMIN_DATABASE_URL ||
		runtimeEnv.OWNER_RECOVERY_SECRET
	) {
		throw new Error(
			"Privileged command credentials must not be provided to serve",
		);
	}
	return { ...web, ...worker };
}

export function readPlatformCommandEnv(runtimeEnv: Environment = process.env) {
	return createEnv({
		...options,
		server: {
			...files,
			...billing,
			...platform,
			CONTROL_ADMIN_DATABASE_URL: databaseUrl.optional(),
			CONTROL_DATABASE_URL: databaseUrl.optional(),
			RECOVERY_DATABASE_URL: databaseUrl.optional(),
			PLATFORM_OPERATOR_DATABASE_URL: databaseUrl.optional(),
			INSTALLATION_ID: z.uuid().optional(),
			OPENFGA_API_URL: origin.optional(),
			AUTH_SECRET: z.string().min(32).optional(),
			RECOVERY_PUBLIC_KEY: z.string().min(32).optional(),
		},
		runtimeEnv,
	});
}
