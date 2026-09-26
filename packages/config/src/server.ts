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
		server: { DATABASE_URL: databaseUrl, APP_ORIGIN: origin },
		runtimeEnv,
	});
}
export function readWorkerEnv(runtimeEnv: Environment = process.env) {
	return createEnv({
		...options,
		server: { WORKER_DATABASE_URL: databaseUrl },
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
		runtimeEnv.IDENTITY_DATABASE_URL
	) {
		throw new Error(
			"Privileged command credentials must not be provided to serve",
		);
	}
	return { ...web, ...worker };
}
