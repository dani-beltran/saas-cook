import { randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { organizations } from "@common-saas/testing";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import {
	createDatabase,
	hasProbe,
	readHeartbeat,
	recordHeartbeat,
	recordProbe,
} from "./index";
import { runMigrations } from "./migrate";

const adminUrl =
	process.env.TEST_DATABASE_ADMIN_URL ??
	"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
const migrationsFolder = fileURLToPath(
	new URL("../migrations", import.meta.url),
);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture() {
	const admin = new Pool({ connectionString: adminUrl });
	const name = `phase1_test_${randomUUID().replaceAll("-", "")}`;
	await admin.query(`CREATE DATABASE ${name} OWNER common_saas_migrator`);
	cleanup.push(async () => {
		await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
		await admin.end();
	});
	function url(role: string) {
		const result = new URL(adminUrl);
		result.pathname = `/${name}`;
		result.username = role;
		result.password = "local_phase1";
		return result.toString();
	}
	const migrator = url("common_saas_migrator");
	const web = createDatabase(url("common_saas_web"));
	const worker = createDatabase(url("common_saas_worker"));
	const identity = createDatabase(url("common_saas_identity"));
	cleanup.push(async () => {
		await Promise.all([web.pool.end(), worker.pool.end(), identity.pool.end()]);
	});
	return { migrator, web, worker, identity };
}

describe("real PostgreSQL migration and runtime role boundary", () => {
	it("upgrades Phase 2 to resource tables while preserving tenant and identity history", async () => {
		const f = await fixture();
		const previous = await mkdtemp(path.join(tmpdir(), "common-saas-phase2-"));
		cleanup.push(() => rm(previous, { recursive: true, force: true }));
		await mkdir(path.join(previous, "meta"));
		const journal = JSON.parse(
			await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
		);
		journal.entries = journal.entries.slice(0, 6);
		await writeFile(
			path.join(previous, "meta/_journal.json"),
			JSON.stringify(journal),
		);
		for (const entry of journal.entries)
			await copyFile(
				path.join(migrationsFolder, `${entry.tag}.sql`),
				path.join(previous, `${entry.tag}.sql`),
			);
		await runMigrations({
			databaseUrl: f.migrator,
			migrationsFolder: previous,
		});
		const migration = new Pool({ connectionString: f.migrator });
		cleanup.push(() => migration.end());
		const userId = randomUUID(),
			orgId = randomUUID(),
			memberId = randomUUID(),
			auditId = randomUUID();
		await f.identity.pool.query(
			'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$1,$2,true)',
			[userId, `${userId}@example.test`],
		);
		await migration.query(
			"INSERT INTO tenancy.organizations(id,slug,name) VALUES($1,$2,'Upgrade history')",
			[orgId, `upgrade-${orgId}`],
		);
		await migration.query(
			"INSERT INTO tenancy.memberships(id,organization_id,user_id,role,status,billable) VALUES($1,$2,$3,'owner','active',true)",
			[memberId, orgId, userId],
		);
		await migration.query(
			"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes,request_id) VALUES($1,$2,$3,'fixture.retained',$4,'{}',$1)",
			[auditId, orgId, userId, orgId],
		);
		await runMigrations({ databaseUrl: f.migrator });
		expect(
			(
				await migration.query(
					"SELECT id FROM tenancy.memberships WHERE organization_id=$1",
					[orgId],
				)
			).rows,
		).toEqual([{ id: memberId }]);
		expect(
			(
				await migration.query(
					"SELECT id FROM tenancy.audit_events WHERE organization_id=$1",
					[orgId],
				)
			).rows,
		).toEqual([{ id: auditId }]);
		for (const table of [
			"projects",
			"workspaces",
			"resource_registry",
			"resource_grants",
			"service_accounts",
			"api_keys",
			"capacity_buckets",
			"capacity_reservations",
			"resource_operations",
		]) {
			const policy = await migration.query(
				"SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
				[`tenancy.${table}`],
			);
			expect(policy.rows[0]).toEqual({
				relrowsecurity: true,
				relforcerowsecurity: true,
			});
			expect(
				(await f.web.pool.query(`SELECT * FROM tenancy.${table}`)).rows,
			).toEqual([]);
			await expect(
				f.web.pool.query(`TRUNCATE tenancy.${table}`),
			).rejects.toMatchObject({ code: "42501" });
		}
	});
	it("migrates fresh, safely replays and processes durable two-organization synthetic probes", async () => {
		const f = await fixture();
		await runMigrations({ databaseUrl: f.migrator });
		await runMigrations({ databaseUrl: f.migrator });
		for (const organization of organizations) {
			await recordProbe(f.worker.pool, organization.id);
			await recordProbe(f.worker.pool, organization.id);
			expect(await hasProbe(f.web.pool, organization.id)).toBe(true);
		}
		expect(
			(
				await f.worker.pool.query(
					"SELECT count(*)::int AS count FROM foundation.runtime_probes",
				)
			).rows[0].count,
		).toBe(2);
		await recordHeartbeat(f.worker.pool, "worker");
		expect(await readHeartbeat(f.web.pool, "worker")).toBeInstanceOf(Date);
	});
	it("upgrades the previous synthetic baseline and preserves existing rows", async () => {
		const f = await fixture();
		const previous = await mkdtemp(
			path.join(tmpdir(), "common-saas-previous-"),
		);
		cleanup.push(() => rm(previous, { recursive: true, force: true }));
		await mkdir(path.join(previous, "meta"));
		const journal = JSON.parse(
			await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
		);
		journal.entries = journal.entries.slice(0, 1);
		await writeFile(
			path.join(previous, "meta/_journal.json"),
			JSON.stringify(journal),
		);
		await copyFile(
			path.join(migrationsFolder, "0000_foundation.sql"),
			path.join(previous, "0000_foundation.sql"),
		);
		await runMigrations({
			databaseUrl: f.migrator,
			migrationsFolder: previous,
		});
		await recordHeartbeat(f.worker.pool, "previous-release-fixture");
		await expect(
			f.web.pool.query("SELECT 1 FROM foundation.runtime_probes"),
		).rejects.toMatchObject({ code: "42P01" });
		await runMigrations({ databaseUrl: f.migrator });
		expect(
			await readHeartbeat(f.web.pool, "previous-release-fixture"),
		).toBeInstanceOf(Date);
		await recordProbe(f.worker.pool, organizations[0].id);
		expect(await hasProbe(f.web.pool, organizations[0].id)).toBe(true);
	});
	it("denies runtime DDL, web writes and cross-schema identity access using actual roles", async () => {
		const f = await fixture();
		await runMigrations({ databaseUrl: f.migrator });
		for (const runtime of [f.web, f.worker, f.identity]) {
			const flags = await runtime.pool.query(
				"SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = current_user",
			);
			expect(flags.rows[0]).toEqual({
				rolsuper: false,
				rolbypassrls: false,
				rolcreaterole: false,
			});
			await expect(
				runtime.pool.query("CREATE TABLE foundation.forbidden (id integer)"),
			).rejects.toMatchObject({ code: "42501" });
			await expect(
				runtime.pool.query("TRUNCATE foundation.runtime_heartbeats"),
			).rejects.toMatchObject({ code: "42501" });
		}
		await expect(recordHeartbeat(f.web.pool, "forged")).rejects.toMatchObject({
			code: "42501",
		});
		await expect(
			f.web.pool.query('SELECT * FROM identity."user"'),
		).rejects.toMatchObject({ code: "42501" });
		await expect(
			f.worker.pool.query('SELECT * FROM identity."user"'),
		).rejects.toMatchObject({ code: "42501" });
		await expect(
			f.identity.pool.query('SELECT * FROM identity."user"'),
		).resolves.toMatchObject({ rows: [] });
		const runtimeUrl = new URL(f.migrator);
		runtimeUrl.username = "common_saas_web";
		await expect(
			runMigrations({ databaseUrl: runtimeUrl.toString() }),
		).rejects.toThrow("dedicated common_saas_migrator");
	});
	it("upgrades the complete Phase 1 schema without treating retained identities as a ready installation", async () => {
		const f = await fixture();
		const previous = await mkdtemp(path.join(tmpdir(), "common-saas-phase1-"));
		cleanup.push(() => rm(previous, { recursive: true, force: true }));
		await mkdir(path.join(previous, "meta"));
		const journal = JSON.parse(
			await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
		);
		journal.entries = journal.entries.slice(0, 2);
		await writeFile(
			path.join(previous, "meta/_journal.json"),
			JSON.stringify(journal),
		);
		for (const migration of ["0000_foundation.sql", "0001_durable_probes.sql"])
			await copyFile(
				path.join(migrationsFolder, migration),
				path.join(previous, migration),
			);
		await runMigrations({
			databaseUrl: f.migrator,
			migrationsFolder: previous,
		});
		const userId = randomUUID();
		await f.identity.pool.query(
			'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$1,$2,true)',
			[userId, `${userId}@example.test`],
		);
		await recordProbe(f.worker.pool, organizations[0].id);
		await runMigrations({ databaseUrl: f.migrator });
		await runMigrations({ databaseUrl: f.migrator });
		expect(await hasProbe(f.web.pool, organizations[0].id)).toBe(true);
		expect(
			(
				await f.web.pool.query(
					"SELECT id,lifecycle_status,credential_epoch FROM identity.lookup_user($1)",
					[userId],
				)
			).rows,
		).toEqual([
			{ id: userId, lifecycle_status: "active", credential_epoch: "1" },
		]);
		expect(
			(
				await f.web.pool.query(
					"SELECT installation_id FROM foundation.installation",
				)
			).rows,
		).toEqual([]);
		expect(
			(await f.web.pool.query("SELECT id FROM tenancy.organizations")).rows,
		).toEqual([]);
		await expect(
			f.web.pool.query('SELECT * FROM identity."user"'),
		).rejects.toMatchObject({ code: "42501" });
	});
});
