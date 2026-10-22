import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

const [mode, candidateArgument, stateArgument] = process.argv.slice(2);
const candidate = path.resolve(candidateArgument);
const statePath = path.resolve(stateArgument);
const load = (file: string) =>
	import(pathToFileURL(path.join(candidate, file)).href);
const localUrl = (role: string, name: string, control = false) => {
	const u = new URL(
		control
			? "postgres://postgres:local_phase2_control@127.0.0.1:55434/postgres"
			: "postgres://postgres:local_phase1@127.0.0.1:55433/postgres",
	);
	u.username = role;
	u.pathname = `/${name}`;
	return u.href;
};
if (mode === "create") {
	const { resourceFixture } = await load("scripts/phase3/fixture.ts");
	const f = await resourceFixture();
	try {
		const actor = await f.user();
		actor.assertCurrent = async () => new Date(Date.now() + 60000);
		const org = (await f.organization(actor)).id;
		const input = {
			name: "Retained evaluation customization data",
			slug: `retained-${randomUUID()}`,
			operationKey: randomUUID(),
		};
		const project = await f.resources.createProject(actor, org, input);
		const migrations = (
			await f.app.query(
				"SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id",
			)
		).rows;
		const state = {
			version: 1,
			createdAt: new Date().toISOString(),
			name: new URL(f.installation.env.DATABASE_URL).pathname.slice(1),
			installationId: f.installation.env.INSTALLATION_ID,
			userId: actor.userId,
			org,
			projectId: project.id,
			input,
			migrations,
			storeId: (
				await f.reader.query(
					"SELECT store_id FROM control.installations WHERE installation_id=$1",
					[f.installation.env.INSTALLATION_ID],
				)
			).rows[0].store_id,
		};
		await mkdir(path.join(candidate, "artifacts"), { recursive: true });
		await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
		await writeFile(
			path.join(candidate, "artifacts/evaluation-checkpoint.json"),
			`${JSON.stringify({ name: state.name, userId: state.userId, org, projectId: project.id, migrationCount: migrations.length, readOnly: true }, null, 2)}\n`,
		);
		console.log(
			JSON.stringify({
				mode,
				passed: true,
				projectId: project.id,
				migrationCount: migrations.length,
			}),
		);
	} finally {
		await Promise.all([
			f.app.end(),
			f.web.end(),
			f.identity.end(),
			f.reader.end(),
		]);
	}
} else {
	const state = JSON.parse(await readFile(statePath, "utf8"));
	assert.match(state.name, /^phase2_test_[a-f0-9]{32}$/);
	const app = new Pool({
		connectionString: localUrl("saas_cook_migrator", state.name),
	});
	try {
		if (mode === "verify") {
			assert.deepEqual(
				(
					await app.query(
						"SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id",
					)
				).rows,
				state.migrations,
			);
			const rows = (
				await app.query(
					"SELECT id,name FROM tenancy.projects WHERE organization_id=$1 AND slug=$2",
					[state.org, state.input.slug],
				)
			).rows;
			assert.equal(rows.length, 1);
			assert.equal(rows[0].id, state.projectId);
			assert.equal(rows[0].name, state.input.name);
			console.log(
				JSON.stringify({
					mode,
					passed: true,
					projectId: state.projectId,
					migrationCount: state.migrations.length,
				}),
			);
		} else if (mode === "cleanup") {
			const response = await fetch(
				`http://127.0.0.1:18081/stores/${state.storeId}`,
				{ method: "DELETE", signal: AbortSignal.timeout(5000) },
			);
			assert.ok(response.ok);
		} else throw new Error("Unknown mode");
	} finally {
		await app.end();
	}
	if (mode === "cleanup") {
		for (const control of [false, true]) {
			const admin = new Pool({
				connectionString: localUrl("postgres", "postgres", control),
			});
			try {
				await admin.query(`DROP DATABASE ${state.name} WITH (FORCE)`);
			} finally {
				await admin.end();
			}
		}
		console.log(JSON.stringify({ mode, passed: true }));
	}
}
