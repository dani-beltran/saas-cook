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
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import { runMigrations } from "../../db/src/migrate";
import { createResourceService } from "../../db/src/resources";
import type { TenantActor } from "../../db/src/tenancy";
import { upgradeAuthorization } from "./commands";
import { fgaRequest } from "./fga";
import { createAuthorizationService } from "./index";
import { phase3ModelHash, type Tuple } from "./model";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});

describe("published predecessor access retirement", () => {
	it("preserves organization/direct/team/deny behavior and retires inherited-only access after schema and model upgrades", async () => {
		const f = await resourceFixture();
		cleanup.push(f.cleanup);
		const name = `retirement_${randomUUID().replaceAll("-", "")}`;
		const admin = new Pool({
			connectionString:
				process.env.TEST_DATABASE_ADMIN_URL ??
				"postgres://postgres:local_phase1@127.0.0.1:55433/postgres",
		});
		await admin.query(`CREATE DATABASE ${name} OWNER common_saas_migrator`);
		cleanup.push(async () => {
			await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
			await admin.end();
		});
		const url = (source: string) => {
			const result = new URL(source);
			result.pathname = `/${name}`;
			return result.toString();
		};
		const databaseUrl = url(f.installation.migrationUrl);
		const app = new Pool({ connectionString: databaseUrl });
		const web = new Pool({
			connectionString: url(f.installation.env.DATABASE_URL),
		});
		const identity = new Pool({
			connectionString: url(f.installation.env.IDENTITY_DATABASE_URL),
		});
		const control = new Pool({ connectionString: f.installation.controlUrl });
		cleanup.push(async () => {
			await Promise.all([app.end(), web.end(), identity.end(), control.end()]);
		});
		const previous = await mkdtemp(path.join(tmpdir(), "authz-predecessor-"));
		cleanup.push(() => rm(previous, { recursive: true, force: true }));
		const migrations = fileURLToPath(
			new URL("../../db/migrations", import.meta.url),
		);
		await mkdir(path.join(previous, "meta"));
		const journal = JSON.parse(
			await readFile(path.join(migrations, "meta/_journal.json"), "utf8"),
		);
		journal.entries = journal.entries.slice(0, 7);
		await writeFile(
			path.join(previous, "meta/_journal.json"),
			JSON.stringify(journal),
		);
		for (const entry of journal.entries)
			await copyFile(
				path.join(migrations, `${entry.tag}.sql`),
				path.join(previous, `${entry.tag}.sql`),
			);
		await runMigrations({ databaseUrl, migrationsFolder: previous });
		const publication = (
			await control.query("SELECT * FROM control.installations")
		).rows[0];
		const predecessor = JSON.parse(
			await readFile(
				new URL("./fixtures/phase3-model.json", import.meta.url),
				"utf8",
			),
		);
		const model = await fgaRequest<{ authorization_model_id: string }>(
			f.installation.env.OPENFGA_API_URL,
			`/stores/${publication.store_id}/authorization-models`,
			predecessor,
		);
		await control.query(
			"UPDATE control.installations SET model_id=$1,model_hash=$2",
			[model.authorization_model_id, phase3ModelHash],
		);
		await app.query(
			"INSERT INTO foundation.installation(installation_id,binding_id,recovery_epoch) VALUES($1,$2,$3)",
			[publication.installation_id, publication.binding_id, publication.epoch],
		);
		const org = randomUUID();
		await app.query(
			"INSERT INTO tenancy.organizations(id,name,slug) VALUES($1,'Migrated Projects',$1::uuid::text)",
			[org],
		);
		await app.query(
			"INSERT INTO tenancy.authorization_revisions(organization_id,desired_revision,applied_revision,store_id,model_id,model_hash,recovery_epoch,ready) VALUES($1,3,3,$2,$3,$4,$5,true)",
			[
				org,
				publication.store_id,
				model.authorization_model_id,
				phase3ModelHash,
				publication.epoch,
			],
		);
		const kinds = [
			"owner",
			"admin",
			"direct",
			"team",
			"denied",
			"inherited",
			"expired",
		] as const;
		const actors = new Map<string, TenantActor>();
		const memberships = new Map<string, string>();
		for (const kind of kinds) {
			const userId = randomUUID(),
				membershipId = randomUUID();
			await identity.query(
				'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$2,$3,true)',
				[userId, kind, `${userId}@example.test`],
			);
			await app.query(
				"INSERT INTO tenancy.memberships(id,organization_id,user_id,role,status,billable) VALUES($1,$2,$3,$4,'active',true)",
				[
					membershipId,
					org,
					userId,
					kind === "owner" || kind === "admin" ? kind : "member",
				],
			);
			actors.set(kind, {
				userId,
				authenticatedAt: new Date(),
				mfa: true,
				method: "passkey",
			});
			memberships.set(kind, membershipId);
		}
		const actor = (kind: string) => {
			const value = actors.get(kind);
			if (!value) throw new Error("Missing synthetic actor");
			return value;
		};
		const team = randomUUID();
		await app.query(
			"INSERT INTO tenancy.teams(id,organization_id,name,slug) VALUES($1,$2,'Retained team','retained')",
			[team, org],
		);
		await app.query(
			"INSERT INTO tenancy.team_members(organization_id,team_id,membership_id) VALUES($1,$2,$3)",
			[org, team, memberships.get("team")],
		);
		const parents = [randomUUID(), randomUUID()];
		for (const [index, parent] of parents.entries()) {
			await app.query(
				"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type) VALUES($1,$2,'workspace')",
				[parent, org],
			);
			await app.query(
				"INSERT INTO tenancy.workspaces(id,organization_id,name,slug,archived_at) VALUES($1,$2,'Historical container',$1::uuid::text,CASE WHEN $3::boolean THEN now() ELSE NULL END)",
				[parent, org, index === 1],
			);
			await app.query(
				"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,membership_id) VALUES($1,$2,$3,'viewer',$4)",
				[randomUUID(), org, parent, memberships.get("inherited")],
			);
		}
		const projects = [randomUUID(), randomUUID(), randomUUID()];
		for (const [index, project] of projects.entries()) {
			await app.query(
				"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type,parent_id) VALUES($1,$2,'project',$3)",
				[project, org, parents[index] ?? null],
			);
			await app.query(
				"INSERT INTO tenancy.projects(id,organization_id,name,slug,owner_membership_id,workspace_id) VALUES($1,$2,'Preserved Project',$1::uuid::text,$3,$4)",
				[project, org, memberships.get("owner"), parents[index] ?? null],
			);
			for (const [kind, relation] of [
				["direct", "viewer"],
				["denied", "viewer"],
				["denied", "denied"],
				["expired", "viewer"],
			])
				await app.query(
					"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,membership_id,expires_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $6::boolean THEN now()-interval '1 day' ELSE NULL END)",
					[
						randomUUID(),
						org,
						project,
						relation,
						memberships.get(kind),
						kind === "expired",
					],
				);
			await app.query(
				"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,team_id) VALUES($1,$2,$3,'editor',$4)",
				[randomUUID(), org, project, team],
			);
		}
		await app.query(
			"INSERT INTO tenancy.capacity_buckets(id,organization_id,feature,policy_kind,capacity,consumed) VALUES($1,$2,'projects.max_active','unlimited',NULL,3)",
			[randomUUID(), org],
		);
		// Independently materialize the actual predecessor rows, proving the retired
		// path was effective before cleanup. Production never writes permission tuples.
		const namespace = `retirement/${randomUUID()}`;
		const organizationObject = `organization:${namespace}/root`;
		const teamObject = `team:${namespace}/${team}`;
		const tuples: Tuple[] = [
			{
				user: organizationObject,
				relation: "organization",
				object: teamObject,
			},
			{
				user: `user:${actor("team").userId}`,
				relation: "member",
				object: teamObject,
			},
		];
		for (const kind of kinds) {
			tuples.push({
				user: `user:${actor(kind).userId}`,
				relation: "member",
				object: organizationObject,
			});
			if (kind === "owner" || kind === "admin")
				tuples.push({
					user: `user:${actor(kind).userId}`,
					relation: kind,
					object: organizationObject,
				});
		}
		const registry = (
			await app.query<{
				id: string;
				resource_type: string;
				parent_id: string | null;
			}>("SELECT id,resource_type,parent_id FROM tenancy.resource_registry")
		).rows;
		const objects = new Map(
			registry.map((row) => [
				row.id,
				`${row.resource_type}:${namespace}/${row.id}`,
			]),
		);
		for (const row of registry) {
			const object = objects.get(row.id);
			if (!object) throw new Error("Missing synthetic registry object");
			tuples.push({
				user: organizationObject,
				relation: "organization",
				object,
			});
			if (row.parent_id)
				tuples.push({
					user: `workspace:${namespace}/${row.parent_id}`,
					relation: "workspace",
					object,
				});
		}
		const grants = (
			await app.query<{
				resource_id: string;
				relation: string;
				user_id: string | null;
				team_id: string | null;
			}>(
				"SELECT g.resource_id,g.relation,m.user_id,g.team_id FROM tenancy.resource_grants g LEFT JOIN tenancy.memberships m ON m.id=g.membership_id WHERE g.expires_at IS NULL OR g.expires_at>clock_timestamp()",
			)
		).rows;
		for (const grant of grants) {
			const object = objects.get(grant.resource_id);
			if (!object) throw new Error("Missing synthetic grant target");
			tuples.push({
				user: grant.team_id ? `${teamObject}#member` : `user:${grant.user_id}`,
				relation: grant.relation,
				object,
			});
		}
		await fgaRequest(
			f.installation.env.OPENFGA_API_URL,
			`/stores/${publication.store_id}/write`,
			{
				authorization_model_id: model.authorization_model_id,
				writes: { tuple_keys: tuples },
			},
		);
		for (const kind of kinds) {
			const decision = await fgaRequest<{ allowed: boolean }>(
				f.installation.env.OPENFGA_API_URL,
				`/stores/${publication.store_id}/check`,
				{
					authorization_model_id: model.authorization_model_id,
					tuple_key: {
						user: `user:${actor(kind).userId}`,
						relation: "can_read",
						object: objects.get(projects[0]),
					},
					consistency: "HIGHER_CONSISTENCY",
				},
			);
			expect(decision.allowed, `${kind} predecessor`).toBe(
				!["denied", "expired"].includes(kind),
			);
		}
		await runMigrations({ databaseUrl });
		await upgradeAuthorization({
			applicationPool: app,
			controlPool: control,
			installationId: publication.installation_id,
			openfgaUrl: f.installation.env.OPENFGA_API_URL,
		});
		const authorization = createAuthorizationService({
			controlPool: f.reader,
			installationId: publication.installation_id,
			openfgaUrl: f.installation.env.OPENFGA_API_URL,
		});
		const resources = createResourceService(web, {
			authorize: authorization.authorizeResource,
			check: authorization.checkResource,
			checkBatch: authorization.checkResourceBatch,
			sourceCommit: authorization.sourceCommit,
		});
		for (const kind of kinds) {
			for (const id of projects) {
				const request = resources.getProject(actor(kind), org, { id });
				if (["inherited", "denied", "expired"].includes(kind))
					await expect(request, `${kind} after migration`).rejects.toThrow();
				else expect((await request).id).toBe(id);
			}
		}
		expect(
			(await resources.listProjects(actor("inherited"), org)).items,
		).toEqual([]);
		expect(
			(await resources.listProjects(actor("direct"), org)).items
				.map((project) => project.id)
				.sort(),
		).toEqual([...projects].sort());
		expect(
			(
				await resources.updateProject(actor("team"), org, {
					id: projects[0],
					version: 1,
					name: "Team editor survives",
				})
			).name,
		).toBe("Team editor survives");
		const explicit = await resources.grant(actor("owner"), org, {
			resourceId: projects[0],
			subject: { kind: "membership", id: memberships.get("inherited") ?? "" },
			relation: "viewer",
			operationKey: randomUUID(),
		});
		expect(
			(await resources.getProject(actor("inherited"), org, { id: projects[0] }))
				.id,
		).toBe(projects[0]);
		await expect(
			resources.getProject(actor("inherited"), org, { id: projects[1] }),
		).rejects.toThrow();
		await resources.revokeGrant(actor("owner"), org, { grantId: explicit.id });
		await expect(
			resources.getProject(actor("inherited"), org, { id: projects[0] }),
		).rejects.toThrow();
	});
});
