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
import { organizations } from "@saas-cook/testing";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { dropTestDatabase } from "../../testing/src/database";
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
	await admin.query(`CREATE DATABASE ${name} OWNER saas_cook_migrator`);
	cleanup.push(async () => {
		await dropTestDatabase(admin, name);
		await admin.end();
	});
	function url(role: string) {
		const result = new URL(adminUrl);
		result.pathname = `/${name}`;
		result.username = role;
		result.password = "local_phase1";
		return result.toString();
	}
	const migrator = url("saas_cook_migrator");
	const web = createDatabase(url("saas_cook_web"));
	const worker = createDatabase(url("saas_cook_worker"));
	const identity = createDatabase(url("saas_cook_identity"));
	cleanup.push(async () => {
		await Promise.all([web.pool.end(), worker.pool.end(), identity.pool.end()]);
	});
	return { migrator, web, worker, identity };
}

async function precedingSchema(databaseUrl: string, count: number) {
	const previous = await mkdtemp(path.join(tmpdir(), "saas-cook-upgrade-"));
	cleanup.push(() => rm(previous, { recursive: true, force: true }));
	await mkdir(path.join(previous, "meta"));
	const journal = JSON.parse(
		await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
	);
	journal.entries = journal.entries.slice(0, count);
	await writeFile(
		path.join(previous, "meta/_journal.json"),
		JSON.stringify(journal),
	);
	for (const entry of journal.entries)
		await copyFile(
			path.join(migrationsFolder, `${entry.tag}.sql`),
			path.join(previous, `${entry.tag}.sql`),
		);
	await runMigrations({ databaseUrl, migrationsFolder: previous });
}

describe("real PostgreSQL migration and runtime role boundary", () => {
	it("retires populated Workspace access while preserving Projects, direct grants, receipts and historical payloads", async () => {
		const f = await fixture();
		await precedingSchema(f.migrator, 7);
		const migration = new Pool({ connectionString: f.migrator });
		cleanup.push(() => migration.end());
		const org = randomUUID(),
			user = randomUUID(),
			member = randomUUID(),
			team = randomUUID(),
			service = randomUUID(),
			workspace = randomUUID(),
			archivedWorkspace = randomUUID(),
			emptyWorkspace = randomUUID();
		const epoch = randomUUID(),
			binding = randomUUID(),
			installation = randomUUID();
		await f.identity.pool.query(
			'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$1,$2,true)',
			[user, `${user}@example.test`],
		);
		await migration.query(
			"INSERT INTO tenancy.organizations(id,name,slug) VALUES($1,'Preserved organization',$2)",
			[org, `upgrade-${org}`],
		);
		await migration.query(
			"INSERT INTO tenancy.memberships(id,organization_id,user_id,role,status,billable) VALUES($1,$2,$3,'owner','active',true)",
			[member, org, user],
		);
		await migration.query(
			"INSERT INTO tenancy.teams(id,organization_id,name,slug) VALUES($1,$2,'Retained team','retained-team')",
			[team, org],
		);
		await migration.query(
			"INSERT INTO tenancy.team_members(organization_id,team_id,membership_id) VALUES($1,$2,$3)",
			[org, team, member],
		);
		await migration.query(
			"INSERT INTO foundation.installation(installation_id,binding_id,recovery_epoch) VALUES($1,$2,$3)",
			[installation, binding, epoch],
		);
		// Retain mismatched revisions and a closed readiness gate; migration is not recovery.
		await migration.query(
			"INSERT INTO tenancy.authorization_revisions(organization_id,desired_revision,applied_revision,store_id,model_id,model_hash,recovery_epoch,ready) VALUES($1,7,5,'old-store','old-model','old-hash',$2,false)",
			[org, epoch],
		);
		await migration.query(
			"INSERT INTO tenancy.service_accounts(id,organization_id,name,capabilities) VALUES($1,$2,'Retained account',ARRAY['project:read','workspace:read','project:move'])",
			[service, org],
		);
		const key = randomUUID(),
			retiredKey = randomUUID();
		for (const [id, scopes] of [
			[key, ["workspace:read", "project:read", "project:move"]],
			[retiredKey, ["workspace:manage", "project:move"]],
		] as const)
			await migration.query(
				"INSERT INTO tenancy.api_keys(id,organization_id,service_account_id,prefix,secret_hash,scopes,expires_at,recovery_epoch) VALUES($1,$2,$3,'synthetic', $4,$5,clock_timestamp()+interval '1 day',$6)",
				[id, org, service, id.replaceAll("-", "").repeat(2), scopes, epoch],
			);
		for (const id of [workspace, archivedWorkspace, emptyWorkspace]) {
			await migration.query(
				"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type) VALUES($1,$2,'workspace')",
				[id, org],
			);
			await migration.query(
				"INSERT INTO tenancy.workspaces(id,organization_id,name,slug,archived_at) VALUES($1,$2,'Retired',$3,CASE WHEN $4::boolean THEN now() ELSE NULL END)",
				[id, org, `w-${id}`, id === archivedWorkspace],
			);
		}
		const projectIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
		const parents = [workspace, archivedWorkspace, null, archivedWorkspace];
		for (let index = 0; index < projectIds.length; index++) {
			await migration.query(
				"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type,parent_id,deleted_at) VALUES($1,$2,'project',$3,CASE WHEN $4::boolean THEN now() ELSE NULL END)",
				[projectIds[index], org, parents[index], index === 3],
			);
			await migration.query(
				"INSERT INTO tenancy.projects(id,organization_id,name,slug,description,status,owner_membership_id,workspace_id,version,deleted_at) VALUES($1,$2,$3,$4,'Keep business data',$5,$6,$7,9,CASE WHEN $8::boolean THEN now() ELSE NULL END)",
				[
					projectIds[index],
					org,
					`Project ${index}`,
					`p-${projectIds[index]}`,
					index === 1 ? "archived" : "active",
					member,
					parents[index],
					index === 3,
				],
			);
		}
		const directGrant = randomUUID(),
			directDeny = randomUUID(),
			workspaceGrant = randomUUID();
		await migration.query(
			"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,membership_id) VALUES($1,$2,$3,'manager',$4),($5,$2,$3,'denied',$4),($6,$2,$7,'viewer',$4)",
			[
				directGrant,
				org,
				projectIds[0],
				member,
				directDeny,
				workspaceGrant,
				workspace,
			],
		);
		await migration.query(
			"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,team_id,expires_at) VALUES($1,$2,$3,'editor',$4,now()+interval '1 day'),($5,$2,$3,'denied',$4,NULL)",
			[randomUUID(), org, archivedWorkspace, team, randomUUID()],
		);
		await migration.query(
			"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,service_account_id,expires_at) VALUES($1,$2,$3,'viewer',$4,now()-interval '1 day')",
			[randomUUID(), org, workspace, service],
		);
		const projectBucket = randomUUID(),
			workspaceBucket = randomUUID(),
			genericBucket = randomUUID();
		for (const [id, feature] of [
			[projectBucket, "projects.max_active"],
			[workspaceBucket, "workspaces.max_active"],
			[genericBucket, "storage.bytes"],
		]) {
			await migration.query(
				"INSERT INTO tenancy.capacity_buckets(id,organization_id,feature,policy_kind,capacity,consumed,reserved) VALUES($1,$2,$3,'limited',20,3,1)",
				[id, org, feature],
			);
			await migration.query(
				"INSERT INTO tenancy.capacity_reservations(id,organization_id,bucket_id,operation_key,quantity,expires_at) VALUES($1,$2,$3,$4,1,now()+interval '1 day')",
				[randomUUID(), org, id, randomUUID()],
			);
		}
		const projectReceipt = randomUUID(),
			directGrantReceipt = randomUUID();
		for (const [operationKey, operation, resource] of [
			[projectReceipt, "project.create", projectIds[0]],
			[directGrantReceipt, "resource.grant", directGrant],
			[randomUUID(), "workspace.create", workspace],
			[randomUUID(), "resource.grant", workspaceGrant],
			[randomUUID(), "project.move", projectIds[1]],
		])
			await migration.query(
				"INSERT INTO tenancy.resource_operations(organization_id,actor_id,operation,operation_key,input_hash,resource_id) VALUES($1,$2,$3,$4,'retained-original-hash',$5)",
				[org, `user:${user}`, operation, operationKey, resource],
			);
		const audit = randomUUID();
		const payload = {
			workspaceId: archivedWorkspace,
			fromWorkspaceId: workspace,
			version: 9,
		};
		await migration.query(
			"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes) VALUES($1,$2,$3,'project.moved',$4,$5)",
			[audit, org, user, projectIds[0], payload],
		);
		await migration.query(
			"INSERT INTO tenancy.outbox_events(id,organization_id,type,payload) VALUES($1,$2,'project.moved',$3)",
			[audit, org, payload],
		);
		const beforeProjects = (
			await migration.query(
				"SELECT to_jsonb(p)-'workspace_id' AS row FROM tenancy.projects p ORDER BY id",
			)
		).rows;
		const beforeDirect = (
			await migration.query(
				"SELECT * FROM tenancy.resource_grants WHERE id=ANY($1::uuid[]) ORDER BY id",
				[[directGrant, directDeny]],
			)
		).rows;
		const beforeCapacity = (
			await migration.query(
				"SELECT * FROM tenancy.capacity_buckets WHERE id=ANY($1::uuid[]) ORDER BY id",
				[[projectBucket, genericBucket]],
			)
		).rows;
		await runMigrations({ databaseUrl: f.migrator });
		await runMigrations({ databaseUrl: f.migrator });
		expect(
			(
				await migration.query(
					"SELECT to_jsonb(p) AS row FROM tenancy.projects p ORDER BY id",
				)
			).rows,
		).toEqual(beforeProjects);
		expect(
			(
				await migration.query(
					"SELECT * FROM tenancy.resource_grants ORDER BY id",
				)
			).rows,
		).toEqual(beforeDirect);
		expect(
			(
				await migration.query(
					"SELECT * FROM tenancy.capacity_buckets ORDER BY id",
				)
			).rows,
		).toEqual(beforeCapacity);
		expect(
			(
				await migration.query(
					"SELECT count(*)::int AS count FROM tenancy.capacity_reservations",
				)
			).rows[0],
		).toEqual({ count: 2 });
		expect(
			(
				await migration.query(
					"SELECT operation_key,input_hash FROM tenancy.resource_operations ORDER BY operation_key",
				)
			).rows,
		).toEqual(
			[projectReceipt, directGrantReceipt].sort().map((operation_key) => ({
				operation_key,
				input_hash: "retained-original-hash",
			})),
		);
		expect(
			(
				await migration.query(
					"SELECT capabilities,version FROM tenancy.service_accounts WHERE id=$1",
					[service],
				)
			).rows[0],
		).toEqual({ capabilities: ["project:read"], version: 2 });
		expect(
			(
				await migration.query(
					"SELECT scopes FROM tenancy.api_keys WHERE id=$1",
					[key],
				)
			).rows[0],
		).toEqual({ scopes: ["project:read"] });
		expect(
			(
				await migration.query(
					"SELECT scopes,revoked_at,recovery_epoch FROM tenancy.api_keys WHERE id=$1",
					[retiredKey],
				)
			).rows[0],
		).toEqual({ scopes: [], revoked_at: null, recovery_epoch: epoch });
		expect(
			(
				await migration.query(
					"SELECT changes FROM tenancy.audit_events WHERE id=$1",
					[audit],
				)
			).rows[0],
		).toEqual({ changes: payload });
		expect(
			(
				await migration.query(
					"SELECT payload FROM tenancy.outbox_events WHERE id=$1",
					[audit],
				)
			).rows[0],
		).toEqual({ payload });
		expect(
			(
				await migration.query(
					"SELECT changes FROM tenancy.audit_events WHERE action='migration.workspace_retired'",
				)
			).rows,
		).toEqual([
			{
				changes: {
					accessPolicy: "retire-inherited-access",
					resharing: "explicit-project-grants-required",
					workspaces: 3,
					detached_projects: 3,
					retired_grants: 4,
					changed_service_accounts: 1,
					changed_api_keys: 2,
					retired_capacity_buckets: 1,
					retired_receipts: 3,
				},
			},
		]);
		expect(
			(
				await migration.query(
					"SELECT desired_revision,applied_revision,store_id,model_id,model_hash,recovery_epoch,ready FROM tenancy.authorization_revisions WHERE organization_id=$1",
					[org],
				)
			).rows[0],
		).toEqual({
			desired_revision: "8",
			applied_revision: "6",
			store_id: "old-store",
			model_id: "old-model",
			model_hash: "old-hash",
			recovery_epoch: epoch,
			ready: false,
		});
		expect(
			(
				await migration.query(
					"SELECT installation_id,binding_id,recovery_epoch FROM foundation.installation",
				)
			).rows[0],
		).toEqual({
			installation_id: installation,
			binding_id: binding,
			recovery_epoch: epoch,
		});
		expect(
			(
				await migration.query(
					"SELECT membership_id FROM tenancy.team_members WHERE team_id=$1",
					[team],
				)
			).rows,
		).toEqual([{ membership_id: member }]);
		expect(
			(
				await migration.query(
					"SELECT to_regclass('tenancy.workspaces') AS retired",
				)
			).rows[0],
		).toEqual({ retired: null });
		expect(
			(
				await migration.query(
					"SELECT resource_type FROM tenancy.resource_registry",
				)
			).rows,
		).toEqual(projectIds.map(() => ({ resource_type: "project" })));
		await expect(
			migration.query(
				"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type) VALUES($1,$2,'workspace')",
				[randomUUID(), org],
			),
		).rejects.toMatchObject({ code: "23514" });
		await expect(
			migration.query("SELECT workspace_id FROM tenancy.projects"),
		).rejects.toMatchObject({ code: "42703" });
		await expect(
			migration.query("SELECT parent_id FROM tenancy.resource_registry"),
		).rejects.toMatchObject({ code: "42703" });
	});
	it("rolls back retirement when a custom dependency prevents the reviewed drop and resumes safely", async () => {
		const f = await fixture();
		await precedingSchema(f.migrator, 7);
		const migration = new Pool({ connectionString: f.migrator });
		cleanup.push(() => migration.end());
		const org = randomUUID(),
			workspace = randomUUID();
		await migration.query(
			"INSERT INTO tenancy.organizations(id,name,slug) VALUES($1,'Custom dependency',$2)",
			[org, `custom-${org}`],
		);
		await migration.query(
			"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type) VALUES($1,$2,'workspace')",
			[workspace, org],
		);
		await migration.query(
			"INSERT INTO tenancy.workspaces(id,organization_id,name,slug) VALUES($1,$2,'Retired container','retired-container')",
			[workspace, org],
		);
		await migration.query(
			"CREATE VIEW tenancy.custom_container_reference AS SELECT id FROM tenancy.workspaces",
		);
		await expect(runMigrations({ databaseUrl: f.migrator })).rejects.toThrow();
		expect(
			(await migration.query("SELECT id FROM tenancy.workspaces")).rows,
		).toEqual([{ id: workspace }]);
		expect(
			(await migration.query("SELECT id FROM tenancy.resource_registry")).rows,
		).toEqual([{ id: workspace }]);
		expect(
			(
				await migration.query(
					"SELECT id FROM tenancy.audit_events WHERE action='migration.workspace_retired'",
				)
			).rows,
		).toEqual([]);
		expect(
			(
				await migration.query(
					"SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
				)
			).rows[0],
		).toEqual({ count: 7 });
		await migration.query("DROP VIEW tenancy.custom_container_reference");
		await runMigrations({ databaseUrl: f.migrator });
		await runMigrations({ databaseUrl: f.migrator });
		expect(
			(
				await migration.query(
					"SELECT count(*)::int AS count FROM tenancy.audit_events WHERE action='migration.workspace_retired'",
				)
			).rows[0],
		).toEqual({ count: 1 });
		expect(
			(
				await migration.query(
					"SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
				)
			).rows[0],
		).toEqual({ count: 11 });
	});
	it("upgrades Phase 2 to resource tables while preserving tenant and identity history", async () => {
		const f = await fixture();
		const previous = await mkdtemp(path.join(tmpdir(), "saas-cook-phase2-"));
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
		const previous = await mkdtemp(path.join(tmpdir(), "saas-cook-previous-"));
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
		runtimeUrl.username = "saas_cook_web";
		await expect(
			runMigrations({ databaseUrl: runtimeUrl.toString() }),
		).rejects.toThrow("dedicated saas_cook_migrator");
	});
	it("upgrades the complete Phase 1 schema without treating retained identities as a ready installation", async () => {
		const f = await fixture();
		const previous = await mkdtemp(path.join(tmpdir(), "saas-cook-phase1-"));
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
