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

it("upgrades a populated 0007 predecessor without changing identity, Project, history or readiness; replays safely", async () => {
	const adminUrl =
		process.env.TEST_DATABASE_ADMIN_URL ??
		"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
	const admin = new Pool({ connectionString: adminUrl });
	const database = `phase2_test_${randomUUID().replaceAll("-", "")}`;
	const url = new URL(adminUrl);
	url.pathname = `/${database}`;
	url.username = "saas_cook_migrator";
	url.password = "local_phase1";
	const folder = await mkdtemp(join(tmpdir(), "customer-upgrade-"));
	let migrator: Pool | undefined;
	try {
		await admin.query(`CREATE DATABASE ${database} OWNER saas_cook_migrator`);
		await mkdir(join(folder, "meta"));
		const journal = JSON.parse(
			await readFile("packages/db/migrations/meta/_journal.json", "utf8"),
		);
		journal.entries = journal.entries.slice(0, 8);
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
		migrator = new Pool({ connectionString: url.href });
		const org = randomUUID(),
			project = randomUUID(),
			event = randomUUID(),
			epoch = randomUUID();
		await migrator.query(
			"INSERT INTO tenancy.organizations(id,name,slug) VALUES($1,'Preserved organization',$2)",
			[org, `upgrade-${org}`],
		);
		await migrator.query(
			"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type) VALUES($1,$2,'project')",
			[project, org],
		);
		await migrator.query(
			"INSERT INTO tenancy.projects(id,organization_id,name,slug,version) VALUES($1,$2,'Preserved project','preserved',7)",
			[project, org],
		);
		await migrator.query(
			"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes) VALUES($1,$2,'synthetic','retained.event',$3,'{\"retained\":true}')",
			[event, org, project],
		);
		await migrator.query(
			"INSERT INTO tenancy.outbox_events(id,organization_id,type,payload) VALUES($1,$2,'retained.event','{\"retained\":true}')",
			[event, org],
		);
		await migrator.query(
			"INSERT INTO tenancy.authorization_revisions(organization_id,desired_revision,applied_revision,store_id,model_id,model_hash,recovery_epoch,ready) VALUES($1,7,5,'old-store','old-model','old-hash',$2,false)",
			[org, epoch],
		);
		const tables = [
			"organizations",
			"projects",
			"audit_events",
			"outbox_events",
			"authorization_revisions",
		];
		const before = await Promise.all(
			tables.map((table) => migrator?.query(`SELECT * FROM tenancy.${table}`)),
		);
		await runMigrations({ databaseUrl: url.href });
		await runMigrations({ databaseUrl: url.href });
		for (let i = 0; i < tables.length; i++)
			expect(
				(await migrator.query(`SELECT * FROM tenancy.${tables[i]}`)).rows,
			).toEqual(before[i]?.rows);
		expect(
			(await migrator.query("SELECT * FROM tenancy.example_customers")).rows,
		).toEqual([]);
		expect(
			(
				await migrator.query(
					"SELECT count(*) FROM drizzle.__drizzle_migrations",
				)
			).rows[0].count,
		).toBe("27");
		expect(
			(
				await migrator.query(
					"SELECT has_table_privilege('saas_cook_web','tenancy.example_customers','DELETE') AS remove,has_column_privilege('saas_cook_web','tenancy.example_customers','organization_id','UPDATE') AS move,has_table_privilege('saas_cook_worker','tenancy.example_customers','SELECT') AS worker,has_table_privilege('saas_cook_worker','tenancy.example_customers','INSERT,UPDATE,DELETE') AS worker_write",
				)
			).rows[0],
		).toEqual({
			remove: false,
			move: false,
			worker: true,
			worker_write: false,
		});
	} finally {
		await migrator?.end();
		await dropTestDatabase(admin, database);
		await admin.end();
		await rm(folder, { recursive: true, force: true });
	}
});
