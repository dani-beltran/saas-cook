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
function validateBilling<
	T extends {
		BILLING_ENABLED: string;
		STRIPE_MODE: string;
		STRIPE_SECRET_KEY?: string;
		STRIPE_WEBHOOK_SECRET?: string;
		STRIPE_ACCOUNT_ID?: string;
		STRIPE_PORTAL_CONFIGURATION_ID?: string;
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
		},
		runtimeEnv,
	});
	if (env.AUTH_INGRESS_SECRET === env.AUTH_SECRET) {
		throw new Error("Authentication and ingress signing keys must differ");
	}
	return validateBilling(env);
}
export function readWorkerEnv(runtimeEnv: Environment = process.env) {
	return validateBilling(
		createEnv({
			...options,
			server: {
				WORKER_DATABASE_URL: databaseUrl,
				APP_ORIGIN: origin.default("http://localhost:3000"),
				...billing,
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
		runtimeEnv.OWNER_RECOVERY_SECRET
	) {
		throw new Error(
			"Privileged command credentials must not be provided to serve",
		);
	}
	return { ...web, ...worker };
}
