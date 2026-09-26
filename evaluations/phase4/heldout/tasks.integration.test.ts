import { createHmac, randomUUID } from "node:crypto";
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
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: Controller-owned evaluation, never a Turbo-cached task.
const candidate = process.env.PHASE4_CANDIDATE_ROOT;
if (!candidate) throw new Error("A disposable candidate is required");
const load = (file: string) =>
	import(pathToFileURL(path.join(candidate, file)).href);
const { resourceFixture } = await load("scripts/phase3/fixture.ts");
const { createTaskService } = await load("packages/db/src/tasks.ts");
const { createApiKeyService } = await load("packages/authz/src/keys.ts");
let f: Awaited<ReturnType<typeof resourceFixture>>;
let tasks: ReturnType<typeof createTaskService>;
let owner: Awaited<ReturnType<typeof f.user>>;
let member: Awaited<ReturnType<typeof f.user>>;
let org: string;
let other: string;
let membership: string;
let project: { id: string; version: number };
let closeRuntime: (() => Promise<void>) | undefined;

beforeAll(async () => {
	f = await resourceFixture();
	owner = await f.user();
	member = await f.user();
	org = (await f.organization(owner)).id;
	other = (await f.organization(owner)).id;
	membership = await f.member(owner, org, member);
	await f.member(owner, other, member);
	project = await f.resources.createProject(owner, org, {
		name: "Held-out Project",
		slug: `held-${randomUUID()}`,
		operationKey: randomUUID(),
	});
	tasks = createTaskService(f.web, {
		authorize: f.authorization.authorizeResource,
		check: f.authorization.checkResource,
		checkBatch: f.authorization.checkResourceBatch,
		sourceCommit: f.authorization.sourceCommit,
	});
});
afterAll(async () => {
	await closeRuntime?.();
	await f?.cleanup();
});
const create = (title = "Evaluator task", operationKey = randomUUID()) =>
	tasks.create(owner, org, { projectId: project.id, title, operationKey });

it("task-02 child CRUD, current parent inheritance and SQL tenant constraints", async () => {
	const key = randomUUID();
	const task = await create("Retained child", key);
	expect((await create("Retained child", key)).id).toBe(task.id);
	await expect(create("Different payload", key)).rejects.toThrow();
	expect((await tasks.get(owner, org, { id: task.id })).title).toBe(
		"Retained child",
	);
	await expect(tasks.get(owner, other, { id: task.id })).rejects.toThrow();
	await expect(
		tasks.create(owner, other, {
			projectId: project.id,
			title: "Foreign",
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	const columns = (
		await f.app.query(
			"SELECT attname FROM pg_attribute WHERE attrelid='tenancy.tasks'::regclass AND attname IN ('title','summary') AND NOT attisdropped",
		)
	).rows.map((row: { attname: string }) => row.attname);
	const titleColumn = columns.includes("summary") ? "summary" : "title";
	expect(columns).toContain(titleColumn);
	await expect(
		f.app.query(
			`INSERT INTO tenancy.tasks(id,organization_id,project_id,${titleColumn}) VALUES($1,$2,$3,'foreign')`,
			[randomUUID(), other, project.id],
		),
	).rejects.toMatchObject({ code: "23503" });
	await expect(tasks.get(member, org, { id: task.id })).rejects.toThrow();
	const grant = await f.resources.grant(owner, org, {
		resourceId: project.id,
		subject: { kind: "membership", id: membership },
		relation: "viewer",
		operationKey: randomUUID(),
	});
	expect((await tasks.get(member, org, { id: task.id })).id).toBe(task.id);
	await expect(
		tasks.update(member, org, {
			id: task.id,
			version: task.version,
			title: "Denied",
		}),
	).rejects.toThrow();
	await f.resources.revokeGrant(owner, org, { grantId: grant.id });
	await expect(tasks.get(member, org, { id: task.id })).rejects.toThrow();
	const updated = await tasks.update(owner, org, {
		id: task.id,
		version: task.version,
		title: "Updated",
	});
	await expect(
		tasks.update(owner, org, {
			id: task.id,
			version: task.version,
			title: "Stale",
		}),
	).rejects.toThrow();
	const deleted = await tasks.delete(owner, org, {
		id: task.id,
		version: updated.version,
		operationKey: randomUUID(),
	});
	await expect(tasks.get(owner, org, { id: task.id })).rejects.toThrow();
	const restored = await tasks.restore(owner, org, {
		id: task.id,
		version: deleted.version,
		operationKey: randomUUID(),
	});
	expect(restored.title).toBe("Updated");
	expect((await f.web.query("SELECT id FROM tenancy.tasks")).rows).toEqual([]);
	expect(
		(
			await f.app.query(
				"SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='tenancy.tasks'::regclass",
			)
		).rows[0],
	).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
});

it("task-03 scoped service variant revalidates key and parent grants", async () => {
	const keys = createApiKeyService({
		pool: f.web,
		authorization: f.authorization,
	});
	const account = await keys.createAccount(owner, org, {
		name: "Held-out automation",
		capabilities: [],
		operationKey: randomUUID(),
	});
	const issued = await keys.issue(owner, org, {
		serviceAccountId: account.id,
		scopes: ["project:read", "project:update"],
		expiresAt: new Date(Date.now() + 600_000),
		operationKey: randomUUID(),
	});
	const actor = await keys.authenticate(org, issued.secret);
	await expect(
		tasks.create(actor, org, {
			projectId: project.id,
			title: "No grant",
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	const grant = await f.resources.grant(owner, org, {
		resourceId: project.id,
		subject: { kind: "serviceAccount", id: account.id },
		relation: "editor",
		operationKey: randomUUID(),
	});
	const task = await tasks.create(actor, org, {
		projectId: project.id,
		title: "Key task",
		operationKey: randomUUID(),
	});
	expect((await tasks.get(actor, org, { id: task.id })).id).toBe(task.id);
	await expect(tasks.get(actor, other, { id: task.id })).rejects.toThrow();
	await f.resources.revokeGrant(owner, org, { grantId: grant.id });
	await expect(tasks.get(actor, org, { id: task.id })).rejects.toThrow();
	await f.resources.grant(owner, org, {
		resourceId: project.id,
		subject: { kind: "serviceAccount", id: account.id },
		relation: "editor",
		operationKey: randomUUID(),
	});
	await keys.revoke(owner, org, actor.apiKeyId);
	await expect(tasks.get(actor, org, { id: task.id })).rejects.toThrow();
});

it("task-05 bounded pagination, DTOs, filters and audit allowlists", async () => {
	const secret = `sensitive-${randomUUID()}`;
	const task = await create(secret);
	await create("Another pagination candidate");
	const expected = [
		"id",
		"organizationId",
		"projectId",
		"title",
		"completed",
		"version",
		"createdAt",
		"updatedAt",
		"deletedAt",
		"notes",
		"priority",
	];
	expect(Object.keys(task).every((key) => expected.includes(key))).toBe(true);
	expect(task.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	await expect(
		tasks.list(owner, org, { projectId: project.id, limit: 100000 }),
	).rejects.toThrow();
	await expect(
		tasks.list(owner, org, { projectId: project.id, cursor: "forged" }),
	).rejects.toThrow();
	const page = await tasks.list(owner, org, {
		projectId: project.id,
		limit: 1,
	});
	expect(page.items).toHaveLength(1);
	expect(page).not.toHaveProperty("total");
	expect(page.nextCursor).toEqual(expect.any(String));
	const viewer = await f.resources.grant(owner, org, {
		resourceId: project.id,
		subject: { kind: "membership", id: membership },
		relation: "viewer",
		operationKey: randomUUID(),
	});
	try {
		expect((await tasks.get(member, org, { id: task.id })).id).toBe(task.id);
		await expect(
			tasks.list(member, org, {
				projectId: project.id,
				cursor: page.nextCursor,
				limit: 1,
			}),
		).rejects.toThrow();
	} finally {
		await f.resources.revokeGrant(owner, org, { grantId: viewer.id });
	}
	const events = (
		await f.app.query(
			"SELECT changes FROM tenancy.audit_events WHERE target_id=$1",
			[task.id],
		)
	).rows;
	expect(events.length).toBeGreaterThan(0);
	expect(JSON.stringify(events)).not.toContain(secret);
});

it("task-06 racing replay has one resource, one event and honors disabled Projects", async () => {
	const key = randomUUID();
	const results = await Promise.all([
		create("Racing request", key),
		create("Racing request", key),
	]);
	expect(results[0].id).toBe(results[1].id);
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.tasks WHERE id=$1",
				[results[0].id],
			)
		).rows[0].n,
	).toBe(1);
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.audit_events WHERE target_id=$1 AND action='task.created'",
				[results[0].id],
			)
		).rows[0].n,
	).toBe(1);
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.outbox_events WHERE payload->>'targetId'=$1 AND type='task.created'",
				[results[0].id],
			)
		).rows[0].n,
	).toBe(1);
	await f.resources.setProjectPolicy(owner, org, {
		enabled: false,
		maxActive: null,
	});
	try {
		await expect(create("Disabled")).rejects.toThrow();
		expect((await tasks.get(owner, org, { id: results[0].id })).id).toBe(
			results[0].id,
		);
	} finally {
		await f.resources.setProjectPolicy(owner, org, {
			enabled: true,
			maxActive: 100,
		});
	}
});

it("task-04 final transaction expiry rolls back child writes and semantic events", async () => {
	const delayed = createTaskService(f.web, {
		authorize: async (
			...args: Parameters<typeof f.authorization.authorizeResource>
		) => {
			await f.authorization.authorizeResource(...args);
			await args[0].query(
				"SELECT set_config('app.authorization_expires_at',(clock_timestamp()-interval '1 second')::text,true)",
			);
		},
		check: f.authorization.checkResource,
		sourceCommit: f.authorization.sourceCommit,
	});
	const counts = async () =>
		(
			await f.app.query(
				`SELECT
				 (SELECT count(*)::int FROM tenancy.tasks WHERE organization_id=$1) AS tasks,
				 (SELECT count(*)::int FROM tenancy.audit_events WHERE organization_id=$1 AND action='task.created') AS audit,
				 (SELECT count(*)::int FROM tenancy.outbox_events WHERE organization_id=$1 AND type='task.created') AS outbox`,
				[org],
			)
		).rows[0];
	const before = await counts();
	await expect(
		delayed.create(owner, org, {
			projectId: project.id,
			title: "Expired",
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	expect(await counts()).toEqual(before);
});

it("task-03 both transports reject hidden fields and undeclared service endpoints", async () => {
	Object.assign(process.env, f.installation.env, {
		APP_ORIGIN: "http://localhost",
	});
	const { handleApi } = await load("packages/api/src/handlers.ts");
	const { shutdownApplicationRuntime } = await load(
		"packages/api/src/runtime.ts",
	);
	closeRuntime = shutdownApplicationRuntime;
	const epoch = (
		await f.app.query("SELECT recovery_epoch FROM foundation.installation")
	).rows[0].recovery_epoch;
	const token = randomUUID();
	await f.identity.query(
		"INSERT INTO identity.session(id,user_id,token,expires_at,authentication_method,authenticated_at,user_verified,mfa,recovery_epoch) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour','passkey',clock_timestamp(),true,true,$4)",
		[randomUUID(), owner.userId, token, epoch],
	);
	const sig = createHmac("sha256", f.installation.env.AUTH_SECRET)
		.update(token)
		.digest("base64");
	const headers = {
		"content-type": "application/json",
		origin: "http://localhost",
		cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${sig}`)}`,
	};
	const keys = createApiKeyService({
		pool: f.web,
		authorization: f.authorization,
	});
	const account = await keys.createAccount(owner, org, {
		name: "Transport automation",
		capabilities: [],
		operationKey: randomUUID(),
	});
	const issued = await keys.issue(owner, org, {
		serviceAccountId: account.id,
		scopes: ["project:read", "project:update"],
		expiresAt: new Date(Date.now() + 600_000),
		operationKey: randomUUID(),
	});
	await f.resources.grant(owner, org, {
		resourceId: project.id,
		subject: { kind: "serviceAccount", id: account.id },
		relation: "editor",
		operationKey: randomUUID(),
	});
	const bearerHeaders = {
		...headers,
		authorization: `Bearer ${issued.secret}`,
	};
	for (const transport of ["rpc", "rest"] as const) {
		const route =
			transport === "rpc"
				? "/api/rpc/tasks/create"
				: `/api/v1/organizations/${org}/tasks`;
		const input = {
			organizationId: org,
			projectId: project.id,
			title: "Transport",
			operationKey: randomUUID(),
		};
		const request = (value: object, requestHeaders = headers) =>
			new Request(`http://localhost${route}`, {
				method: "POST",
				headers: requestHeaders,
				body: JSON.stringify(transport === "rpc" ? { json: value } : value),
			});
		const ok = await handleApi(request(input), transport);
		expect(ok.status).toBeLessThan(300);
		const invalid = await handleApi(
			request({ ...input, version: 500, deletedAt: new Date().toISOString() }),
			transport,
		);
		expect(invalid.status).toBe(422);
		const serviceAllowed = await handleApi(
			request({ ...input, operationKey: randomUUID() }, bearerHeaders),
			transport,
		);
		expect(serviceAllowed.status).toBe(200);
		for (const endpoint of [
			{
				rpc: "grants/create",
				rest: `organizations/${org}/resource-grants`,
				input: {
					organizationId: org,
					resourceId: project.id,
					subject: { kind: "membership", id: membership },
					relation: "viewer",
					operationKey: randomUUID(),
				},
			},
			{
				rpc: "serviceAccounts/create",
				rest: `organizations/${org}/service-accounts`,
				input: {
					organizationId: org,
					name: "Forbidden automation",
					capabilities: [],
					operationKey: randomUUID(),
				},
			},
		]) {
			const denied = await handleApi(
				new Request(
					`http://localhost/api/${transport === "rpc" ? `rpc/${endpoint.rpc}` : `v1/${endpoint.rest}`}`,
					{
						method: "POST",
						headers: bearerHeaders,
						body: JSON.stringify(
							transport === "rpc" ? { json: endpoint.input } : endpoint.input,
						),
					},
				),
				transport,
			);
			expect(denied.status).toBe(403);
		}
	}
});

it("task-07 evolution preserves customized behavior and changes completion permission only", async () => {
	const customization = await load("packages/db/src/task-customization.ts");
	expect(customization.taskLabel("Example")).toBe("Custom: Example");
	const task = await create("Compatibility title");
	expect(task.notes).toBeNull();
	expect(task.priority).toBe("normal");
	const editor = await f.resources.grant(owner, org, {
		resourceId: project.id,
		subject: { kind: "membership", id: membership },
		relation: "editor",
		operationKey: randomUUID(),
	});
	try {
		const updated = await tasks.update(member, org, {
			id: task.id,
			version: task.version,
			title: "Editor title",
		});
		await expect(
			tasks.update(member, org, {
				id: task.id,
				version: updated.version,
				completed: true,
			}),
		).rejects.toThrow();
		const complete = await tasks.update(owner, org, {
			id: task.id,
			version: updated.version,
			completed: true,
		});
		expect(complete.completed).toBe(true);
		expect(complete.title).toBe("Editor title");
	} finally {
		await f.resources.revokeGrant(owner, org, { grantId: editor.id });
	}
});

it("task-07 predecessor migration retains real rows through rename and required-field backfill", async () => {
	const { Pool } = await import("pg");
	const { runMigrations } = await load("packages/db/src/migrate.ts");
	const folder = path.join(candidate, "packages/db/migrations");
	const journal = JSON.parse(
		await readFile(path.join(folder, "meta/_journal.json"), "utf8"),
	);
	let initial = -1;
	for (const [index, entry] of journal.entries.entries()) {
		const sql = await readFile(path.join(folder, `${entry.tag}.sql`), "utf8");
		if (/CREATE TABLE\s+(?:"?tenancy"?\.)?"?tasks"?/i.test(sql)) {
			initial = index;
			break;
		}
	}
	expect(initial).toBeGreaterThanOrEqual(7);
	expect(journal.entries.length).toBeGreaterThan(initial + 1);
	const previous = await mkdtemp(
		path.join(tmpdir(), "phase4-heldout-upgrade-"),
	);
	const adminUrl =
		process.env.TEST_DATABASE_ADMIN_URL ??
		"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
	const admin = new Pool({ connectionString: adminUrl });
	const name = `phase4_heldout_${randomUUID().replaceAll("-", "")}`;
	const url = new URL(adminUrl);
	url.pathname = `/${name}`;
	url.username = "common_saas_migrator";
	url.password = "local_phase1";
	let db: InstanceType<typeof Pool> | undefined;
	try {
		await mkdir(path.join(previous, "meta"));
		await writeFile(
			path.join(previous, "meta/_journal.json"),
			JSON.stringify({
				...journal,
				entries: journal.entries.slice(0, initial + 1),
			}),
		);
		for (const entry of journal.entries.slice(0, initial + 1))
			await copyFile(
				path.join(folder, `${entry.tag}.sql`),
				path.join(previous, `${entry.tag}.sql`),
			);
		await admin.query(`CREATE DATABASE ${name} OWNER common_saas_migrator`);
		await runMigrations({ databaseUrl: url.href, migrationsFolder: previous });
		db = new Pool({ connectionString: url.href });
		const tenant = randomUUID(),
			parent = randomUUID(),
			child = randomUUID();
		await db.query(
			"INSERT INTO tenancy.organizations(id,name,slug) VALUES($1,'Retained tenant',$2)",
			[tenant, `old-${tenant}`],
		);
		await db.query(
			"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type) VALUES($1,$2,'project')",
			[parent, tenant],
		);
		await db.query(
			"INSERT INTO tenancy.projects(id,organization_id,name,slug) VALUES($1,$2,'Retained Project',$3)",
			[parent, tenant, `old-${parent}`],
		);
		await db.query(
			"INSERT INTO tenancy.tasks(id,organization_id,project_id,title,version) VALUES($1,$2,$3,'Historical title',3)",
			[child, tenant, parent],
		);
		await runMigrations({ databaseUrl: url.href, migrationsFolder: folder });
		await runMigrations({ databaseUrl: url.href, migrationsFolder: folder });
		const row = (
			await db.query(
				"SELECT id,summary,notes,priority,version FROM tenancy.tasks WHERE id=$1",
				[child],
			)
		).rows[0];
		expect(row).toEqual({
			id: child,
			summary: "Historical title",
			notes: null,
			priority: "normal",
			version: 3,
		});
		await expect(
			db.query("UPDATE tenancy.tasks SET priority=NULL WHERE id=$1", [child]),
		).rejects.toMatchObject({ code: "23502" });
	} finally {
		await db?.end();
		await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
		await admin.end();
		await rm(previous, { recursive: true, force: true });
	}
});

it("task-09 new security email is localized, post-commit, retried and redacted", async () => {
	const { createIdentityRuntime } = await load("packages/auth/src/index.ts");
	const { renderIdentityEmail, enqueueIdentityEmail, deliverIdentityEmails } =
		await load("packages/email/src/index.tsx");
	const { Pool } = await import("pg");
	const worker = new Pool({
		connectionString: f.installation.env.WORKER_DATABASE_URL,
	});
	const origin = "https://auth.example.test";
	const secret = f.installation.env.AUTH_SECRET;
	const publication = (
		await f.app.query(
			"SELECT installation_id,binding_id,recovery_epoch FROM foundation.installation",
		)
	).rows[0];
	const runtime = createIdentityRuntime(f.identity, {
		secret,
		origin,
		readiness: async () => ({
			installationId: publication.installation_id,
			bindingId: publication.binding_id,
			epoch: publication.recovery_epoch,
		}),
	});
	const request = (route: string, data: object) =>
		new Request(`${origin}/api/auth/${route}`, {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: JSON.stringify(data),
		});
	const mailbox: { id: string; text: string; html: string; subject: string }[] =
		[];
	const deliver = async () =>
		deliverIdentityEmails(worker, {
			secret,
			transport: async (message: (typeof mailbox)[number]) => {
				mailbox.push(message);
			},
		});
	const emailToken = (pathname: string) =>
		mailbox
			.flatMap((message) =>
				[
					...message.text.matchAll(/https:\/\/auth\.example\.test\/[^\s]+/g),
				].map((match) => new URL(match[0])),
			)
			.find((url) => url.pathname === pathname)
			?.searchParams.get("token");
	try {
		const subjects: string[] = [];
		for (const locale of ["en", "es"]) {
			const message = await renderIdentityEmail({
				kind: "password-changed",
				locale,
				to: "synthetic@example.test",
				url: `${origin}/en/account`,
			});
			expect(message.html).toContain(`lang="${locale}"`);
			expect(message.subject).toBeTruthy();
			expect(message.text).not.toContain("token=");
			subjects.push(message.subject);
		}
		expect(subjects[0]).not.toBe(subjects[1]);
		const email = `heldout-${randomUUID()}@example.test`;
		expect(
			(
				await runtime.handler(
					request("register", {
						email,
						name: "Held-out identity",
						password: "Synthetic original secret 111!",
						locale: "es",
					}),
				)
			).status,
		).toBe(200);
		await deliver();
		const confirmation = emailToken("/auth/confirm");
		expect(confirmation).toBeTruthy();
		expect(
			(await runtime.handler(request("confirm", { token: confirmation })))
				.status,
		).toBe(200);
		mailbox.length = 0;
		expect(
			(
				await runtime.handler(
					request("request-password-reset", { email, locale: "es" }),
				)
			).status,
		).toBe(200);
		await deliver();
		const reset = emailToken("/auth/reset-password");
		expect(reset).toBeTruthy();
		mailbox.length = 0;
		expect(
			(
				await runtime.handler(
					request("reset-password", {
						token: reset,
						newPassword: "Synthetic replacement secret 222!",
						locale: "es",
					}),
				)
			).status,
		).toBe(200);
		const failed = await deliverIdentityEmails(worker, {
			secret,
			transport: async () => {
				throw new Error("synthetic delivery outage");
			},
			limit: 1,
		});
		expect(failed.failed).toBe(1);
		await f.identity.query(
			"UPDATE identity.email_delivery SET available_at=now() WHERE delivered_at IS NULL",
		);
		await deliver();
		expect(mailbox).toHaveLength(1);
		expect(mailbox[0].subject).toBe(subjects[1]);
		expect(JSON.stringify(mailbox)).not.toContain(reset);
		expect(JSON.stringify(mailbox)).not.toContain("replacement secret");
		const receipt = (
			await f.identity.query(
				"SELECT encrypted_payload,attempts FROM identity.email_delivery WHERE id=$1",
				[mailbox[0].id],
			)
		).rows[0];
		expect(receipt).toEqual({ encrypted_payload: "", attempts: 2 });
		const tx = await f.identity.connect();
		try {
			await tx.query("BEGIN");
			await enqueueIdentityEmail(tx, {
				kind: "password-changed",
				locale: "en",
				to: email,
				url: `${origin}/en/account`,
				secret,
				expiresAt: new Date(Date.now() + 600_000),
			});
			expect((await deliver()).delivered).toBe(0);
			await tx.query("ROLLBACK");
			expect((await deliver()).delivered).toBe(0);
		} finally {
			await tx.query("ROLLBACK");
			tx.release();
		}
	} finally {
		await worker.end();
	}
});
