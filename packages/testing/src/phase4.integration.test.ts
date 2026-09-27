import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkTenantCatalog } from "../../../scripts/phase4/tenant-catalog";
import { runMigrations } from "../../db/src/migrate";
import { dropTestDatabase } from "./database";

const adminUrl =
	process.env.TEST_DATABASE_ADMIN_URL ??
	"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
const admin = new Pool({ connectionString: adminUrl });
const name = `phase4_test_${randomUUID().replaceAll("-", "")}`;
let database: Pool;
let created = false;
beforeAll(async () => {
	await admin.query(`CREATE DATABASE ${name} OWNER common_saas_migrator`);
	created = true;
	const url = new URL(adminUrl);
	url.pathname = `/${name}`;
	database = new Pool({ connectionString: url.toString() });
	url.username = "common_saas_migrator";
	url.password = "local_phase1";
	await runMigrations({ databaseUrl: url.toString() });
});
afterAll(async () => {
	await database?.end();
	if (created) await dropTestDatabase(admin, name);
	await admin.end();
});

describe("Phase 4 discovered tenant-table enforcement", () => {
	it("checks every migrated tenant table, relation, policy and actual restricted runtime role", async () => {
		expect(await checkTenantCatalog(database)).toEqual([]);
	});
	it("detects a newly introduced table missing RLS without registering its name", async () => {
		await database.query(
			"CREATE TABLE tenancy.seeded_missing_rls (id uuid, organization_id uuid)",
		);
		try {
			expect(await checkTenantCatalog(database)).toContain(
				"tenancy.seeded_missing_rls: ENABLE and FORCE ROW LEVEL SECURITY required",
			);
		} finally {
			await database.query("DROP TABLE tenancy.seeded_missing_rls");
		}
	});
	it("detects permissive policies behaviorally even when ENABLE/FORCE flags are present", async () => {
		await database.query(
			"CREATE POLICY seeded_permission_bypass ON tenancy.projects TO common_saas_web USING (true) WITH CHECK (true)",
		);
		try {
			const failures = await checkTenantCatalog(database);
			expect(failures).toContain(
				"tenancy.projects: common_saas_web policy exposes rows without tenant context",
			);
			expect(failures).toContain(
				"tenancy.projects: common_saas_web can insert into another tenant",
			);
		} finally {
			await database.query(
				"DROP POLICY seeded_permission_bypass ON tenancy.projects",
			);
		}
	});
	it("detects a cross-tenant relation even when a foreign key exists", async () => {
		await database.query(
			"CREATE TABLE tenancy.seeded_bad_relation (id uuid, organization_id uuid, project_id uuid REFERENCES tenancy.projects(id))",
		);
		try {
			expect(
				(await checkTenantCatalog(database)).some(
					(failure) =>
						failure.includes("seeded_bad_relation") &&
						failure.includes("constrain both tenant identifiers"),
				),
			).toBe(true);
		} finally {
			await database.query("DROP TABLE tenancy.seeded_bad_relation");
		}
	});
});
