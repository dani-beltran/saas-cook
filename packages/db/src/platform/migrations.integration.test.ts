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
import { join } from "node:path";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { dropTestDatabase } from "../../../testing/src/database";
import { runMigrations } from "../migrate";

it("preserves populated Phase 5 source/history/readiness through discovery upgrade and replay", async () => {
	const adminUrl =
		process.env.TEST_DATABASE_ADMIN_URL ??
		"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
	const admin = new Pool({ connectionString: adminUrl }),
		name = `phase2_test_${randomUUID().replaceAll("-", "")}`;
	const url = new URL(adminUrl);
	url.pathname = `/${name}`;
	url.username = "saas_cook_migrator";
	url.password = "local_phase1";
	const folder = await mkdtemp(join(tmpdir(), "phase6-upgrade-"));
	let app: Pool | undefined;
	try {
		await admin.query(`CREATE DATABASE ${name} OWNER saas_cook_migrator`);
		await mkdir(join(folder, "meta"));
		const journal = JSON.parse(
			await readFile("packages/db/migrations/meta/_journal.json", "utf8"),
		);
		journal.entries = journal.entries.slice(0, 11);
		await writeFile(
			join(folder, "meta/_journal.json"),
			JSON.stringify(journal),
		);
		for (const entry of journal.entries)
			await copyFile(
				`packages/db/migrations/${entry.tag}.sql`,
				join(folder, `${entry.tag}.sql`),
			);
		await runMigrations({ databaseUrl: url.href, migrationsFolder: folder });
		app = new Pool({ connectionString: url.href });
		const org = randomUUID(),
			project = randomUUID(),
			event = randomUUID(),
			epoch = randomUUID();
		await app.query(
			"INSERT INTO tenancy.organizations(id,name,slug) VALUES($1,'Preserved',$2)",
			[org, org],
		);
		await app.query(
			"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type) VALUES($1,$2,'project')",
			[project, org],
		);
		await app.query(
			"INSERT INTO tenancy.projects(id,organization_id,name,slug,version) VALUES($1,$2,'Preserved','preserved',4)",
			[project, org],
		);
		await app.query(
			"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes) VALUES($1,$2,'user:private','project.created',$3,'{\"sensitive\":\"not copied\"}')",
			[event, org, project],
		);
		await app.query(
			"INSERT INTO tenancy.authorization_revisions(organization_id,desired_revision,applied_revision,store_id,model_id,model_hash,recovery_epoch,ready) VALUES($1,7,5,'old-store','old-model','old-hash',$2,false)",
			[org, epoch],
		);
		const tables = [
			"projects",
			"organizations",
			"audit_events",
			"authorization_revisions",
		];
		const before = await Promise.all(
			tables.map((t) => app?.query(`SELECT * FROM tenancy.${t}`)),
		);
		await runMigrations({ databaseUrl: url.href });
		await runMigrations({ databaseUrl: url.href });
		for (let i = 0; i < tables.length; i++)
			expect(
				(await app.query(`SELECT * FROM tenancy.${tables[i]}`)).rows,
			).toEqual(before[i]?.rows);
		await app.query("SELECT tenancy.project_activity_event($1,$2)", [
			org,
			event,
		]);
		await app.query("SELECT tenancy.project_activity_event($1,$2)", [
			org,
			event,
		]);
		const activity = (await app.query("SELECT * FROM tenancy.activity_events"))
			.rows;
		expect(activity).toHaveLength(1);
		expect(JSON.stringify(activity)).not.toContain("sensitive");
		expect(
			(
				await app.query(
					"SELECT relforcerowsecurity FROM pg_class WHERE oid='tenancy.activity_events'::regclass",
				)
			).rows[0].relforcerowsecurity,
		).toBe(true);
		expect(
			(
				await app.query(
					"SELECT indexname FROM pg_indexes WHERE indexname IN ('projects_search_name','example_customers_search_name')",
				)
			).rows,
		).toHaveLength(2);
	} finally {
		await app?.end();
		await dropTestDatabase(admin, name);
		await admin.end();
		await rm(folder, { recursive: true, force: true });
	}
});
