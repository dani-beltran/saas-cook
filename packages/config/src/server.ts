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
};
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
	return createEnv({
		...options,
		server: { DATABASE_URL: databaseUrl, APP_ORIGIN: origin, ...identity, ...authorization },
		runtimeEnv,
	});
}
export function readWorkerEnv(runtimeEnv: Environment = process.env) {
	return createEnv({
		...options,
		server: {
			WORKER_DATABASE_URL: databaseUrl,
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
	});
}
export function readMigrationEnv(runtimeEnv: Environment = process.env) {
	return createEnv({
		...options,
		server: { MIGRATION_DATABASE_URL: databaseUrl },
		runtimeEnv,
	});
}
export function readAuthorizationCommandEnv(runtimeEnv: Environment = process.env) {
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
		}, runtimeEnv,
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
