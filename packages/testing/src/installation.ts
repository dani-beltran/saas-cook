import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { dropTestDatabase } from "./database";
import {
	closeFixturePool,
	createFixturePool,
	type FixturePoolOptions,
} from "./pool";

const exec = promisify(execFile);

/** Creates an isolated real-service installation; never reuses or bootstraps ambient data.
 * @param options Optional static pool-failure callback and bounded harness SQL settings.
 * @returns Scoped credentials and cleanup, which attempts every owned resource on failure.
 * @throws Setup or cleanup errors; callers must avoid logging raw database error objects.
 */
export async function createTestInstallation(options: FixturePoolOptions = {}) {
	const adminUrl =
		process.env.TEST_DATABASE_ADMIN_URL ??
		"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
	const controlAdminUrl =
		process.env.TEST_CONTROL_ADMIN_URL ??
		"postgres://postgres:local_phase2_control@127.0.0.1:55434/postgres";
	const name = `phase2_test_${randomUUID().replaceAll("-", "")}`;
	const installationId = randomUUID();
	const fgaUrl = process.env.OPENFGA_API_URL ?? "http://127.0.0.1:18081";
	const admin = createFixturePool(
		{
			connectionString: adminUrl,
			max: 1,
			connectionTimeoutMillis: 5_000,
		},
		"installation-application-admin",
		options,
	);
	const controlAdmin = createFixturePool(
		{
			connectionString: controlAdminUrl,
			max: 1,
			connectionTimeoutMillis: 5_000,
		},
		"installation-control-admin",
		options,
	);
	function url(base: string, role: string, password: string) {
		const value = new URL(base);
		value.pathname = `/${name}`;
		value.username = role;
		value.password = password;
		return value.toString();
	}
	const migrationUrl = url(adminUrl, "saas_cook_migrator", "local_phase1");
	const controlUrl = url(
		controlAdminUrl,
		"saas_cook_control_admin",
		"local_phase2_control",
	);
	const env = {
		DATABASE_URL: url(adminUrl, "saas_cook_web", "local_phase1"),
		IDENTITY_DATABASE_URL: url(adminUrl, "saas_cook_identity", "local_phase1"),
		WORKER_DATABASE_URL: url(adminUrl, "saas_cook_worker", "local_phase1"),
		CONTROL_DATABASE_URL: url(
			controlAdminUrl,
			"saas_cook_control_reader",
			"local_phase2_control",
		),
		INSTALLATION_ID: installationId,
		OPENFGA_API_URL: fgaUrl,
		AUTH_SECRET: "local_phase2_synthetic_secret_not_for_production_0001",
	};
	let appCreated = false;
	let controlCreated = false;
	let cleaned = false;
	async function cleanup() {
		if (cleaned) return;
		cleaned = true;
		const failures: unknown[] = [];
		if (controlCreated) {
			const control = createFixturePool(
				{
					connectionString: controlUrl,
					max: 1,
					connectionTimeoutMillis: 5_000,
				},
				"installation-control-cleanup",
				options,
			);
			try {
				const state = await control
					.query(
						"SELECT store_id FROM control.installations WHERE installation_id=$1",
						[installationId],
					)
					.catch(() => ({ rows: [] }));
				const storeId = state.rows[0]?.store_id;
				if (storeId) {
					if (!/^[A-Z0-9]{26}$/.test(storeId))
						throw new Error("Invalid test model receipt");
					const response = await fetch(
						`${fgaUrl.replace(/\/$/, "")}/stores/${storeId}`,
						{ method: "DELETE", signal: AbortSignal.timeout(5_000) },
					);
					if (!response.ok)
						throw new Error("Test authorization store cleanup failed");
				}
			} catch (error) {
				failures.push(error);
			} finally {
				await closeFixturePool(control).catch((error) => failures.push(error));
			}
		}
		for (const [pool, created] of [
			[admin, appCreated],
			[controlAdmin, controlCreated],
		] as const) {
			try {
				if (created) await dropTestDatabase(pool, name);
			} catch (error) {
				failures.push(error);
			} finally {
				await closeFixturePool(pool).catch((error) => failures.push(error));
			}
		}
		if (failures.length)
			throw new AggregateError(
				failures,
				"Disposable installation cleanup failed",
			);
	}
	try {
		await admin.query(`CREATE DATABASE ${name} OWNER saas_cook_migrator`);
		appCreated = true;
		await controlAdmin.query(
			`CREATE DATABASE ${name} OWNER saas_cook_control_admin`,
		);
		controlCreated = true;
		const commandEnv: NodeJS.ProcessEnv = {
			PATH: process.env.PATH,
			NODE_ENV: "test",
			MIGRATION_DATABASE_URL: migrationUrl,
			CONTROL_ADMIN_DATABASE_URL: controlUrl,
			INSTALLATION_ID: installationId,
			OPENFGA_API_URL: fgaUrl,
		};
		for (const mode of ["migrate", "bootstrap"])
			await exec(
				process.execPath,
				["--import", "tsx", "scripts/phase1/command.ts", mode],
				{ env: commandEnv, timeout: 30_000 },
			);
		return { env, cleanup, migrationUrl, controlUrl };
	} catch (error) {
		await cleanup();
		throw error;
	}
}
