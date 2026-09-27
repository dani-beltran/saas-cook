import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { runOwnerCommand } from "../../../scripts/phase2/owner-command";
import { runMigrations } from "../../db/src/migrate";
import { enqueueIdentityEmail } from "../../email/src/delivery";
import { dropTestDatabase } from "../../testing/src/database";
import { bootstrap, publishAuthorization } from "./commands";
import { getPublication } from "./control";
import { fgaRequest } from "./fga";
import { createAuthorizationService } from "./index";
import { compileContext, type Permission } from "./model";
import type { OperatorApproval } from "./operator";

const adminUrl =
	process.env.TEST_DATABASE_ADMIN_URL ??
	"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
const controlAdminUrl =
	process.env.TEST_CONTROL_ADMIN_URL ??
	"postgres://postgres:local_phase2_control@127.0.0.1:55434/postgres";
const fgaUrl = process.env.OPENFGA_API_URL ?? "http://127.0.0.1:18081";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});

function deferred() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}
async function proxy(
	handler: (
		body: Record<string, unknown>,
		response: ServerResponse,
	) => Promise<void>,
) {
	const server = createServer(async (request: IncomingMessage, response) => {
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(Buffer.from(part));
		try {
			await handler(JSON.parse(Buffer.concat(parts).toString()), response);
		} catch {
			response.writeHead(503).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	cleanup.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing proxy address");
	return `http://127.0.0.1:${address.port}`;
}
async function fixture(ready = true) {
	const admin = new Pool({ connectionString: adminUrl });
	const controlAdmin = new Pool({ connectionString: controlAdminUrl });
	const name = `phase2_authz_${randomUUID().replaceAll("-", "")}`;
	await admin.query(`CREATE DATABASE ${name} OWNER saas_cook_migrator`);
	await controlAdmin.query(
		`CREATE DATABASE ${name} OWNER saas_cook_control_admin`,
	);
	cleanup.push(async () => {
		await dropTestDatabase(admin, name);
		await dropTestDatabase(controlAdmin, name);
		await admin.end();
		await controlAdmin.end();
	});
	function url(base: string, role: string, password: string) {
		const url = new URL(base);
		url.pathname = `/${name}`;
		url.username = role;
		url.password = password;
		return url.toString();
	}
	const migrationUrl = url(adminUrl, "saas_cook_migrator", "local_phase1");
	await runMigrations({ databaseUrl: migrationUrl });
	const app = new Pool({ connectionString: migrationUrl });
	const web = new Pool({
		connectionString: url(adminUrl, "saas_cook_web", "local_phase1"),
	});
	const control = new Pool({
		connectionString: url(
			controlAdminUrl,
			"saas_cook_control_admin",
			"local_phase2_control",
		),
	});
	const reader = new Pool({
		connectionString: url(
			controlAdminUrl,
			"saas_cook_control_reader",
			"local_phase2_control",
		),
	});
	let closing = false;
	for (const pool of [app, web, control, reader])
		pool.on("error", (error) => {
			if (!closing) throw error;
		});
	cleanup.push(async () => {
		closing = true;
		await Promise.all([app.end(), web.end(), control.end(), reader.end()]);
	});
	const installationId = randomUUID();
	const options = {
		applicationPool: app,
		controlPool: control,
		installationId,
		openfgaUrl: fgaUrl,
	};
	if (ready) await bootstrap(options);
	cleanup.push(async () => {
		const result = await control
			.query(
				"SELECT store_id FROM control.installations WHERE installation_id=$1",
				[installationId],
			)
			.catch(() => ({ rows: [] }));
		if (result.rows[0]?.store_id)
			await fgaRequest(
				fgaUrl,
				`/stores/${result.rows[0].store_id}`,
				undefined,
				"DELETE",
			);
	});
	const service = createAuthorizationService({
		controlPool: reader,
		installationId,
		openfgaUrl: fgaUrl,
	});
	const actor = randomUUID(),
		outsider = randomUUID(),
		org = randomUUID(),
		otherOrg = randomUUID(),
		membership = randomUUID(),
		team = randomUUID();
	async function seed() {
		await app.query(
			'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$1,$2,true),($3,$3,$4,true)',
			[actor, `${actor}@example.test`, outsider, `${outsider}@example.test`],
		);
		await app.query(
			"INSERT INTO tenancy.organizations(id,slug,name) VALUES($1,$2,'Alpha'),($3,$4,'Beta')",
			[
				org,
				`alpha-${org.slice(0, 8)}`,
				otherOrg,
				`beta-${otherOrg.slice(0, 8)}`,
			],
		);
		await app.query(
			"INSERT INTO tenancy.memberships(id,organization_id,user_id,role,status,billable) VALUES($1,$2,$3,'owner','active',true)",
			[membership, org, actor],
		);
		await app.query(
			"INSERT INTO tenancy.seat_capacities(organization_id,capacity,occupied) VALUES($1,5,1)",
			[org],
		);
		const client = await web.connect();
		try {
			await client.query("BEGIN");
			await client.query("SELECT set_config('app.organization_id',$1,true)", [
				org,
			]);
			await service.initialize(client, org);
			await client.query("COMMIT");
		} finally {
			client.release();
		}
	}
	async function transaction<T>(
		callback: (client: PoolClient) => Promise<T>,
		exclusive = false,
		user = actor,
	): Promise<T> {
		const client = await web.connect();
		client.on("error", () => {});
		try {
			await client.query("BEGIN");
			await client.query("SET LOCAL statement_timeout='5s'");
			await client.query(
				"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
				[`user:${user}`],
			);
			await client.query(
				`SELECT pg_advisory_xact_lock${exclusive ? "" : "_shared"}(hashtextextended($1,0))`,
				[`organization:${org}`],
			);
			await client.query("SELECT set_config('app.organization_id',$1,true)", [
				org,
			]);
			const result = await callback(client);
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK").catch(() => {});
			throw error;
		} finally {
			client.release();
		}
	}
	async function authorize(
		permission: Permission = "read",
		override = service,
	) {
		return transaction((client) =>
			override.authorize(client, actor, org, permission),
		);
	}
	return {
		admin,
		app,
		web,
		control,
		reader,
		options,
		installationId,
		service,
		actor,
		outsider,
		org,
		otherOrg,
		membership,
		team,
		seed,
		transaction,
		authorize,
	};
}

describe("production contextual authorization against real PostgreSQL and OpenFGA", () => {
	it("bootstraps model/independent readiness, uses restricted read role, and refuses existing/restored fresh initialization", async () => {
		const f = await fixture();
		await publishAuthorization(f.options);
		await expect(bootstrap(f.options)).resolves.toBe("already-completed");
		await expect(
			bootstrap({ ...f.options, installationId: randomUUID() }),
		).rejects.toThrow("binding");
		await expect(
			f.reader.query(
				"UPDATE control.installations SET state='recovery_required'",
			),
		).rejects.toMatchObject({ code: "42501" });
		await f.seed();
		await f.authorize("transfer");
		const state = await getPublication(f.reader, f.installationId);
		const tuples = await fgaRequest<{ tuples: unknown[] }>(
			fgaUrl,
			`/stores/${state.storeId}/read`,
			{},
		);
		expect(tuples.tuples).toEqual([]);
	});
	it("recognizes populated completed installations without changing receipts or contacting OpenFGA", async () => {
		const f = await fixture();
		await f.seed();
		const before = await f.control.query("SELECT * FROM control.installations");
		const events = await f.control.query(
			"SELECT * FROM control.security_events ORDER BY id",
		);
		await expect(
			bootstrap({ ...f.options, openfgaUrl: "http://127.0.0.1:1" }),
		).resolves.toBe("already-completed");
		expect(
			(await f.control.query("SELECT * FROM control.installations")).rows,
		).toEqual(before.rows);
		expect(
			(
				await f.control.query(
					"SELECT * FROM control.security_events ORDER BY id",
				)
			).rows,
		).toEqual(events.rows);
	});
	it.each(["binding_id", "recovery_epoch", "installation_id"])(
		"rejects completed installation with mismatched %s",
		async (column) => {
			const f = await fixture();
			await f.app.query(`UPDATE foundation.installation SET ${column}=$1`, [
				randomUUID(),
			]);
			await expect(bootstrap(f.options)).rejects.toThrow(
				"recovery revalidation",
			);
		},
	);
	it("rejects recovery-required state and a changed model after completion", async () => {
		const f = await fixture();
		await f.control.query(
			"UPDATE control.installations SET state='recovery_required'",
		);
		await expect(bootstrap(f.options)).rejects.toThrow("Existing or restored");
		await f.control.query(
			"UPDATE control.installations SET state='ready', model_hash='changed'",
		);
		await expect(bootstrap(f.options)).rejects.toThrow(
			"Independent authorization readiness required",
		);
	});
	it("resumes an interrupted bootstrap from independent pending receipts without resetting its epoch", async () => {
		const f = await fixture(false);
		await expect(
			bootstrap({ ...f.options, openfgaUrl: "http://127.0.0.1:1" }),
		).rejects.toThrow("unavailable");
		const before = (
			await f.control.query(
				"SELECT epoch,binding_id FROM control.installations",
			)
		).rows[0];
		await bootstrap(f.options);
		expect(await getPublication(f.reader, f.installationId)).toMatchObject({
			epoch: before.epoch,
			bindingId: before.binding_id,
		});
	});
	it("rejects populated source data with no independent initialization record", async () => {
		const f = await fixture(false);
		await f.app.query(
			'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$1,$2,true)',
			[f.actor, `${f.actor}@example.test`],
		);
		await expect(bootstrap(f.options)).rejects.toThrow(
			"Existing or restored application data",
		);
	});
	it("checks role/team policy and tenant isolation using authoritative membership", async () => {
		const f = await fixture();
		await f.seed();
		await f.authorize("transfer");
		await expect(
			f.transaction(
				(client) => f.service.authorize(client, f.outsider, f.org, "read"),
				false,
				f.outsider,
			),
		).rejects.toThrow("denied");
		await expect(
			f.transaction((client) =>
				f.service.authorize(client, f.actor, f.otherOrg, "read"),
			),
		).rejects.toThrow("denied");
		await f.app.query(
			"UPDATE tenancy.memberships SET role='member' WHERE id=$1",
			[f.membership],
		);
		await f.app.query(
			"INSERT INTO tenancy.teams(id,organization_id,slug,name) VALUES($1,$2,'team','Team')",
			[f.team, f.org],
		);
		await expect(
			f.transaction((client) =>
				f.service.authorize(client, f.actor, f.org, "read", f.team),
			),
		).rejects.toThrow("denied");
		await f.app.query(
			"INSERT INTO tenancy.team_members(organization_id,team_id,membership_id) VALUES($1,$2,$3)",
			[f.org, f.team, f.membership],
		);
		await f.transaction((client) =>
			f.service.authorize(client, f.actor, f.org, "read", f.team),
		);
		await expect(f.authorize("manage")).rejects.toThrow("denied");
	});
	it("commits revocation with its revision and ignores a persistent late grant in an old request namespace", async () => {
		const f = await fixture();
		await f.seed();
		const state = await getPublication(f.reader, f.installationId);
		const old = compileContext({
			organizationId: f.org,
			epoch: state.epoch,
			actorId: f.actor,
			role: "owner",
		});
		await f.transaction(async (client) => {
			await client.query(
				"UPDATE tenancy.memberships SET role='member' WHERE id=$1",
				[f.membership],
			);
			await f.service.sourceCommit(client, f.org);
		}, true);
		await fgaRequest(fgaUrl, `/stores/${state.storeId}/write`, {
			authorization_model_id: state.modelId,
			writes: { tuple_keys: old.tuples },
		});
		await expect(f.authorize("manage")).rejects.toThrow("denied");
		await f.authorize("read");
		expect(
			(
				await f.app.query(
					"SELECT desired_revision,applied_revision FROM tenancy.authorization_revisions",
				)
			).rows[0],
		).toEqual({ desired_revision: "2", applied_revision: "2" });
	});
	it("drains shared authorization fences before revocation and rejects every later request", async () => {
		const f = await fixture();
		await f.seed();
		const readStarted = deferred(),
			finishRead = deferred();
		const reading = f.transaction(async (client) => {
			await f.service.authorize(client, f.actor, f.org, "read");
			readStarted.release();
			await finishRead.promise;
		});
		await readStarted.promise;
		let committed = false;
		const revoke = f
			.transaction(async (client) => {
				await client.query(
					"UPDATE tenancy.memberships SET status='inactive' WHERE id=$1",
					[f.membership],
				);
				await f.service.sourceCommit(client, f.org);
			}, true)
			.then(() => {
				committed = true;
			});
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(committed).toBe(false);
		finishRead.release();
		await Promise.all([reading, revoke]);
		await expect(f.authorize()).rejects.toThrow("denied");
	});
	it("rejects expired/inactive principals, mismatched model and independent epoch even when revisions match", async () => {
		const f = await fixture();
		await f.seed();
		await f.app.query(
			"UPDATE tenancy.memberships SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
			[f.membership],
		);
		await expect(f.authorize()).rejects.toThrow("denied");
		await f.app.query(
			"UPDATE tenancy.memberships SET expires_at=NULL WHERE id=$1",
			[f.membership],
		);
		await f.app.query(
			"UPDATE identity.\"user\" SET lifecycle_status='frozen' WHERE id=$1",
			[f.actor],
		);
		await expect(f.authorize()).rejects.toThrow("denied");
		await f.app.query(
			"UPDATE identity.\"user\" SET lifecycle_status='active' WHERE id=$1",
			[f.actor],
		);
		const saved = (
			await f.app.query("SELECT model_id FROM tenancy.authorization_revisions")
		).rows[0].model_id;
		await f.app.query(
			"UPDATE tenancy.authorization_revisions SET model_id='wrong-model'",
		);
		await expect(f.authorize()).rejects.toThrow("denied");
		await f.app.query(
			"UPDATE tenancy.authorization_revisions SET model_id=$1",
			[saved],
		);
		await f.control.query(
			"UPDATE control.installations SET epoch=$2 WHERE installation_id=$1",
			[f.installationId, randomUUID()],
		);
		await expect(f.authorize()).rejects.toThrow("recovery revalidation");
		await expect(publishAuthorization(f.options)).rejects.toThrow(
			"recovery revalidation",
		);
	});
	it("does not accept a late allowed HTTP response after the lock-bearing connection is lost", async () => {
		const f = await fixture();
		await f.seed();
		const state = await getPublication(f.reader, f.installationId);
		const received = deferred(),
			release = deferred();
		const base = await proxy(async (body, response) => {
			const decision = await fgaRequest(
				fgaUrl,
				`/stores/${state.storeId}/check`,
				body,
			);
			received.release();
			await release.promise;
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify(decision));
		});
		const delayed = createAuthorizationService({
			controlPool: f.reader,
			installationId: f.installationId,
			openfgaUrl: base,
		});
		let pid = 0;
		const attempt = f.transaction(async (client) => {
			pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
			await delayed.authorize(client, f.actor, f.org, "manage");
			await client.query(
				"UPDATE tenancy.organizations SET name='forbidden late update' WHERE id=$1",
				[f.org],
			);
		});
		const rejected = expect(attempt).rejects.toThrow();
		await received.promise;
		await f.admin.query("SELECT pg_terminate_backend($1)", [pid]);
		release.release();
		await rejected;
		expect(
			(
				await f.app.query(
					"SELECT name FROM tenancy.organizations WHERE id=$1",
					[f.org],
				)
			).rows[0].name,
		).toBe("Alpha");
		const started = performance.now();
		await f.authorize();
		expect(performance.now() - started).toBeLessThan(30_000);
	});
	it("fails closed on endpoint outage, malformed response and actual HTTP timeout, and recovers within 30 seconds", async () => {
		const f = await fixture();
		await f.seed();
		const unavailable = createAuthorizationService({
			controlPool: f.reader,
			installationId: f.installationId,
			openfgaUrl: "http://127.0.0.1:1",
		});
		await expect(f.authorize("read", unavailable)).rejects.toThrow(
			"unavailable",
		);
		const malformed = await proxy(async (_body, response) => {
			response.end("{}");
		});
		await expect(
			f.authorize(
				"read",
				createAuthorizationService({
					controlPool: f.reader,
					installationId: f.installationId,
					openfgaUrl: malformed,
				}),
			),
		).rejects.toThrow("Incomplete");
		const hanging = await proxy(async () => {});
		await expect(
			f.authorize(
				"read",
				createAuthorizationService({
					controlPool: f.reader,
					installationId: f.installationId,
					openfgaUrl: hanging,
				}),
			),
		).rejects.toThrow("unavailable");
		const started = performance.now();
		await f.authorize();
		expect(performance.now() - started).toBeLessThan(30_000);
	});
	it("rejects membership that expires while an actual allowed OpenFGA response is pending", async () => {
		const f = await fixture();
		await f.seed();
		const state = await getPublication(f.reader, f.installationId);
		const delayed = await proxy(async (body, response) => {
			const decision = await fgaRequest(
				fgaUrl,
				`/stores/${state.storeId}/check`,
				body,
			);
			await new Promise((resolve) => setTimeout(resolve, 250));
			response.end(JSON.stringify(decision));
		});
		await f.app.query(
			"UPDATE tenancy.memberships SET expires_at=clock_timestamp()+interval '200 milliseconds' WHERE id=$1",
			[f.membership],
		);
		const service = createAuthorizationService({
			controlPool: f.reader,
			installationId: f.installationId,
			openfgaUrl: delayed,
		});
		await expect(f.authorize("read", service)).rejects.toThrow("expired");
	});

	it("keeps security revocation source commits available while control and FGA readiness are closed", async () => {
		const f = await fixture();
		await f.seed();
		await f.control.query(
			"UPDATE control.installations SET state='recovery_required'",
		);
		await f.transaction(async (client) => {
			await client.query(
				"UPDATE tenancy.memberships SET status='inactive' WHERE id=$1",
				[f.membership],
			);
			await f.service.sourceCommit(client, f.org);
		}, true);
		await expect(f.authorize()).rejects.toThrow("readiness");
		await expect(publishAuthorization(f.options)).rejects.toThrow("readiness");
	});
});

describe("independently signed owner recovery command", () => {
	it("deactivates a sole owner during FGA outage, refuses reopening on outage, then admits a verified replacement and retries without duplicate seats/mail", async () => {
		const f = await fixture();
		await f.seed();
		const state = await getPublication(f.reader, f.installationId);
		const directory = await mkdtemp(path.join(tmpdir(), "phase2-operator-"));
		cleanup.push(() => rm(directory, { recursive: true, force: true }));
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const publicPem = publicKey
			.export({ type: "spki", format: "pem" })
			.toString();
		const common = {
			version: 1 as const,
			installationId: f.installationId,
			epoch: state.epoch,
			operatorId: "verified-control-authority",
			organizationId: f.org,
			evidenceReference: "case:independent-organization-authority",
			mfaAt: new Date(Date.now() - 1000).toISOString(),
			expiresAt: new Date(Date.now() + 180000).toISOString(),
		};
		async function writeApproval(claims: OperatorApproval) {
			const payload = Buffer.from(JSON.stringify(claims));
			const file = path.join(directory, `${claims.nonce}.json`);
			await writeFile(
				file,
				JSON.stringify({
					payload: payload.toString("base64url"),
					signature: sign(null, payload, privateKey).toString("base64url"),
				}),
			);
			return file;
		}
		const deactivate: OperatorApproval = {
			...common,
			nonce: randomUUID(),
			scope: "security:deactivate",
			subjectUserId: f.actor,
			membershipId: f.membership,
		};
		const notify = async (
			client: PoolClient,
			n: { email: string; expiresAt: Date },
		) => {
			await enqueueIdentityEmail(client, {
				kind: "recovery",
				to: n.email,
				locale: "en",
				url: "https://example.test/en/account",
				secret: "synthetic-email-command-secret-at-least-32",
				expiresAt: n.expiresAt,
			});
		};
		const base = {
			applicationPool: f.web,
			controlPool: f.control,
			installationId: f.installationId,
			publicKey: publicPem,
			notify,
		};
		const deactivationFile = await writeApproval(deactivate);
		// A generic domain idempotency row is not an independently signed operation receipt.
		await f.app.query(
			"INSERT INTO tenancy.membership_transitions(organization_id,operation_key,input_hash,membership_id,delta) VALUES($1,$2,'ordinary-input',$3,0)",
			[f.org, `control:${deactivate.nonce}`, f.membership],
		);
		await expect(
			runOwnerCommand({
				...base,
				mode: "security-deactivate",
				approvalFile: deactivationFile,
				openfgaUrl: "http://127.0.0.1:1",
			}),
		).rejects.toThrow();
		expect(
			(
				await f.control.query(
					"SELECT state FROM control.operator_approvals WHERE nonce=$1",
					[deactivate.nonce],
				)
			).rows[0].state,
		).toBe("pending");
		await f.app.query(
			"DELETE FROM tenancy.membership_transitions WHERE organization_id=$1 AND operation_key=$2",
			[f.org, `control:${deactivate.nonce}`],
		);
		await runOwnerCommand({
			...base,
			mode: "security-deactivate",
			approvalFile: deactivationFile,
			openfgaUrl: "http://127.0.0.1:1",
		});
		expect(
			(
				await f.app.query(
					"SELECT status FROM tenancy.organizations WHERE id=$1",
					[f.org],
				)
			).rows[0].status,
		).toBe("owner_recovery_required");
		expect(
			(
				await f.app.query(
					"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
					[f.org],
				)
			).rows[0].occupied,
		).toBe(0);
		const recovery: OperatorApproval = {
			...common,
			nonce: randomUUID(),
			scope: "owner:recover",
			subjectUserId: f.outsider,
			subjectAuthenticatedAt: new Date(Date.now() - 1000).toISOString(),
			subjectMethod: "passkey",
			subjectMfa: true,
		};
		const recoveryFile = await writeApproval(recovery);
		await expect(
			runOwnerCommand({
				...base,
				mode: "owner-recovery",
				approvalFile: recoveryFile,
				openfgaUrl: "http://127.0.0.1:1",
			}),
		).rejects.toThrow("unavailable");
		expect(
			(
				await f.app.query(
					"SELECT status FROM tenancy.organizations WHERE id=$1",
					[f.org],
				)
			).rows[0].status,
		).toBe("owner_recovery_required");
		expect(
			(
				await f.app.query(
					"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
					[f.org],
				)
			).rows[0].occupied,
		).toBe(0);
		await runOwnerCommand({
			...base,
			mode: "owner-recovery",
			approvalFile: recoveryFile,
			openfgaUrl: fgaUrl,
		});
		await runOwnerCommand({
			...base,
			mode: "owner-recovery",
			approvalFile: recoveryFile,
			openfgaUrl: fgaUrl,
		});
		// Simulate loss of the final control-plane acknowledgement after the application commit.
		await f.control.query(
			"UPDATE control.operator_approvals SET state='pending',completed_at=NULL WHERE nonce=$1",
			[recovery.nonce],
		);
		await runOwnerCommand({
			...base,
			mode: "owner-recovery",
			approvalFile: recoveryFile,
			openfgaUrl: fgaUrl,
		});
		expect(
			(
				await f.app.query(
					"SELECT status FROM tenancy.organizations WHERE id=$1",
					[f.org],
				)
			).rows[0].status,
		).toBe("active");
		expect(
			(
				await f.app.query(
					"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
					[f.org],
				)
			).rows[0].occupied,
		).toBe(1);
		expect(
			(await f.app.query("SELECT count(*)::int n FROM identity.email_delivery"))
				.rows[0].n,
		).toBe(1);
		expect(
			(
				await f.control.query(
					"SELECT count(*)::int n FROM control.operator_approvals WHERE state='completed'",
				)
			).rows[0].n,
		).toBe(2);
		expect(
			(
				await f.app.query(
					"SELECT count(DISTINCT request_id)::int AS requests,count(*) FILTER (WHERE request_id IS NULL)::int AS missing FROM tenancy.audit_events WHERE actor_id='verified-control-authority'",
				)
			).rows[0],
		).toEqual({ requests: 2, missing: 0 });
		await f.transaction(
			(client) => f.service.authorize(client, f.outsider, f.org, "transfer"),
			false,
			f.outsider,
		);
		await expect(f.authorize()).rejects.toThrow("denied");
	});
});
