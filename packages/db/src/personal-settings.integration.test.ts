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
import { dropTestDatabase } from "../../testing/src/database";
import { runMigrations } from "./migrate";

it("upgrades populated 0008 identity without rewriting users or history, replays, and preserves restricted roles", async () => {
	const adminUrl =
		process.env.TEST_DATABASE_ADMIN_URL ??
		"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
	const admin = new Pool({ connectionString: adminUrl });
	const database = `personal_test_${randomUUID().replaceAll("-", "")}`;
	const url = new URL(adminUrl);
	url.pathname = `/${database}`;
	url.username = "common_saas_migrator";
	url.password = "local_phase1";
	const folder = await mkdtemp(join(tmpdir(), "personal-upgrade-"));
	let migrator: Pool | undefined;
	try {
		await admin.query(`CREATE DATABASE ${database} OWNER common_saas_migrator`);
		await mkdir(join(folder, "meta"));
		const journal = JSON.parse(
			await readFile("packages/db/migrations/meta/_journal.json", "utf8"),
		);
		journal.entries = journal.entries.slice(0, 9);
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
		await migrator.query(
			`INSERT INTO identity."user"(id,name,email,email_verified,image) VALUES('retained','Retained','retained@example.test',true,'https://legacy.example.test/avatar.png')`,
		);
		await migrator.query(
			"INSERT INTO identity.security_audit(id,user_id,action) VALUES($1,'retained','retained.action')",
			[randomUUID()],
		);
		const before = (await migrator.query('SELECT * FROM identity."user"'))
			.rows[0];
		const history = (
			await migrator.query("SELECT * FROM identity.security_audit")
		).rows;
		await runMigrations({ databaseUrl: url.href });
		await runMigrations({ databaseUrl: url.href });
		expect(
			(await migrator.query('SELECT * FROM identity."user"')).rows[0],
		).toEqual({ ...before, theme_mode: null, theme_version: 0 });
		expect(
			(await migrator.query("SELECT * FROM identity.security_audit")).rows,
		).toEqual(history);
		for (const role of ["common_saas_web", "common_saas_worker"]) {
			const roleUrl = new URL(url);
			roleUrl.username = role;
			const restricted = new Pool({ connectionString: roleUrl.href });
			try {
				await expect(
					restricted.query("SELECT * FROM identity.user_avatar"),
				).rejects.toMatchObject({ code: "42501" });
			} finally {
				await restricted.end();
			}
		}
		await expect(
			migrator.query(`UPDATE identity."user" SET theme_mode='arbitrary'`),
		).rejects.toMatchObject({ code: "23514" });
		await expect(
			migrator.query(
				"INSERT INTO identity.user_avatar(user_id,version,bytes) VALUES('retained',$1,$2)",
				[randomUUID(), Buffer.alloc(524289)],
			),
		).rejects.toMatchObject({ code: "23514" });
		await migrator.query(
			"INSERT INTO identity.user_avatar(user_id,version,bytes) VALUES('retained',$1,$2)",
			[randomUUID(), Buffer.from("bounded")],
		);
		await migrator.query("DELETE FROM identity.security_audit");
		await migrator.query('DELETE FROM identity."user"');
		expect(
			(await migrator.query("SELECT * FROM identity.user_avatar")).rows,
		).toEqual([]);
	} finally {
		await migrator?.end();
		await dropTestDatabase(admin, database);
		await admin.end();
		await rm(folder, { recursive: true, force: true });
	}
});
