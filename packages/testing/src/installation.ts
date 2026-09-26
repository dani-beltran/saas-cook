import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

const exec = promisify(execFile);

/** Test-only installation: never reuse, clear, or bootstrap an ambient application database. */
export async function createTestInstallation() {
	const adminUrl =
		process.env.TEST_DATABASE_ADMIN_URL ??
		"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
	const controlAdminUrl =
		process.env.TEST_CONTROL_ADMIN_URL ??
		"postgres://postgres:local_phase2_control@127.0.0.1:55434/postgres";
	const name = `phase2_test_${randomUUID().replaceAll("-", "")}`;
	const installationId = randomUUID();
	const fgaUrl = process.env.OPENFGA_API_URL ?? "http://127.0.0.1:18081";
	const admin = new Pool({
		connectionString: adminUrl,
		max: 1,
		connectionTimeoutMillis: 5_000,
	});
	const controlAdmin = new Pool({
		connectionString: controlAdminUrl,
		max: 1,
		connectionTimeoutMillis: 5_000,
	});
	function url(base: string, role: string, password: string) {
		const value = new URL(base);
		value.pathname = `/${name}`;
		value.username = role;
		value.password = password;
		return value.toString();
	}
	const migrationUrl = url(adminUrl, "common_saas_migrator", "local_phase1");
	const controlUrl = url(
		controlAdminUrl,
		"common_saas_control_admin",
		"local_phase2_control",
	);
	const env = {
		DATABASE_URL: url(adminUrl, "common_saas_web", "local_phase1"),
		IDENTITY_DATABASE_URL: url(
			adminUrl,
			"common_saas_identity",
			"local_phase1",
		),
		WORKER_DATABASE_URL: url(adminUrl, "common_saas_worker", "local_phase1"),
		CONTROL_DATABASE_URL: url(
			controlAdminUrl,
			"common_saas_control_reader",
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
			const control = new Pool({
				connectionString: controlUrl,
				max: 1,
				connectionTimeoutMillis: 5_000,
			});
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
				await control.end();
			}
		}
		for (const [pool, created] of [
			[admin, appCreated],
			[controlAdmin, controlCreated],
		] as const) {
			try {
				if (created) await pool.query(`DROP DATABASE ${name} WITH (FORCE)`);
			} catch (error) {
				failures.push(error);
			} finally {
				await pool.end();
			}
		}
		if (failures.length)
			throw new AggregateError(
				failures,
				"Disposable installation cleanup failed",
			);
	}
	try {
		await admin.query(`CREATE DATABASE ${name} OWNER common_saas_migrator`);
		appCreated = true;
		await controlAdmin.query(
			`CREATE DATABASE ${name} OWNER common_saas_control_admin`,
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
		return { env, cleanup };
	} catch (error) {
		await cleanup();
		throw error;
	}
}
