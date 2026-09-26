import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import { createResourceService } from "../../db/src/resources";
import { withTenantTransaction } from "../../db/src/tenancy";
import { bootstrap, upgradeAuthorization } from "./commands";
import { fgaRequest } from "./fga";
import { createAuthorizationService } from "./index";
import { compileResourceContext, modelHash, phase2ModelHash } from "./model";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});
function deferred() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { release, promise };
}
async function proxy(
	handler: (
		body: Record<string, unknown>,
		response: ServerResponse,
	) => Promise<void>,
) {
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		try {
			await handler(JSON.parse(Buffer.concat(chunks).toString()), response);
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
async function fixture() {
	const f = await resourceFixture();
	cleanup.push(f.cleanup);
	const owner = await f.user(),
		member = await f.user();
	const org = (await f.organization(owner)).id;
	const membership = await f.member(owner, org, member);
	const project = await f.resources.createProject(owner, org, {
		name: "Protected",
		slug: "protected",
		operationKey: randomUUID(),
	});
	return { ...f, owner, member, org, membership, project };
}
function context() {
	return {
		organizationId: "organization",
		epoch: "epoch",
		actorId: "member",
		actorType: "user" as const,
		role: "member" as const,
		creator: true,
		target: { type: "project" as const, id: "project" },
		workspaceId: "workspace",
		grants: [
			{ resourceId: "workspace", relation: "viewer" as const, teamId: "team" },
		],
	};
}

describe("Phase 3 resource fault and model boundaries", () => {
	it("uses fresh qualified resource/team/parent namespaces and rejects oversized contexts", () => {
		const one = compileResourceContext(context()),
			two = compileResourceContext(context());
		expect(one.object).not.toBe(two.object);
		const namespace = one.object
			.split(":")[1]
			?.split("/")
			.slice(0, 3)
			.join("/");
		for (const tuple of one.tuples) {
			expect(tuple.object).toContain(namespace);
			if (!tuple.user.startsWith("user:"))
				expect(tuple.user).toContain(namespace);
		}
		expect(() =>
			compileResourceContext({
				...context(),
				grants: Array.from({ length: 101 }, (_, index) => ({
					resourceId: "project",
					relation: "viewer" as const,
					teamId: `team-${index}`,
				})),
			}),
		).toThrow("too large");
		expect(() =>
			compileResourceContext({
				...context(),
				grants: [{ resourceId: "other", relation: "viewer" }],
			}),
		).toThrow("target");
	});
	it("rechecks expiry after a real delayed OpenFGA allow on the protected resource", async () => {
		const f = await fixture();
		const grant = await f.resources.grant(f.owner, f.org, {
			resourceId: f.project.id,
			subject: { kind: "membership", id: f.membership },
			relation: "viewer",
			expiresAt: new Date(Date.now() + 60_000),
			operationKey: randomUUID(),
		});
		const expiry = (
			await f.app.query<{ expires_at: Date }>(
				"UPDATE tenancy.resource_grants SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1 RETURNING expires_at",
				[grant.id],
			)
		).rows[0]?.expires_at;
		if (!expiry) throw new Error("Missing grant expiry");
		const publication = await f.authorization.publication(
			await (async () => {
				const c = await f.web.connect();
				cleanup.push(async () => c.release());
				return c;
			})(),
		);
		let remoteAllowed = false;
		const delayed = await proxy(async (body, response) => {
			const result = await fgaRequest<{ allowed: boolean }>(
				f.installation.env.OPENFGA_API_URL,
				`/stores/${publication.storeId}/check`,
				body,
			);
			remoteAllowed = result.allowed;
			await new Promise((resolve) =>
				setTimeout(resolve, Math.max(0, expiry.getTime() - Date.now() + 30)),
			);
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify(result));
		});
		const authorization = createAuthorizationService({
			controlPool: f.reader,
			installationId: f.installation.env.INSTALLATION_ID,
			openfgaUrl: delayed,
		});
		const resources = createResourceService(f.web, {
			authorize: authorization.authorizeResource,
			check: authorization.checkResource,
			sourceCommit: authorization.sourceCommit,
		});
		await expect(
			resources.getProject(f.member, f.org, { id: f.project.id }),
		).rejects.toThrow();
		expect(remoteAllowed).toBe(true);
	});
	it("rejects a late remote allow after the fence connection is terminated and leaves no domain write", async () => {
		const f = await fixture();
		const received = deferred(),
			release = deferred();
		let observed: Record<string, unknown> | undefined;
		const delayed = await proxy(async (body, response) => {
			observed = body;
			received.release();
			await release.promise;
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ allowed: true }));
		});
		const authorization = createAuthorizationService({
			controlPool: f.reader,
			installationId: f.installation.env.INSTALLATION_ID,
			openfgaUrl: delayed,
		});
		let pid = 0;
		let lostError: unknown;
		const operation = withTenantTransaction(
			f.web,
			f.org,
			[f.owner.userId],
			false,
			async (client) => {
				client.on("error", (error) => {
					lostError = error;
				});
				pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
					.pid;
				await authorization.authorizeResource(
					client,
					f.owner,
					f.org,
					{ type: "project", id: f.project.id },
					"update",
				);
				await client.query(
					"UPDATE tenancy.projects SET name='Late write' WHERE id=$1",
					[f.project.id],
				);
			},
		);
		const outcome = operation.then(
			() => null,
			(error) => error,
		);
		await received.promise;
		const admin = new Pool({
			connectionString:
				process.env.TEST_DATABASE_ADMIN_URL ??
				"postgres://postgres:local_phase1@127.0.0.1:55433/postgres",
		});
		try {
			await admin.query("SELECT pg_terminate_backend($1)", [pid]);
		} finally {
			await admin.end();
		}
		release.release();
		expect(await outcome).toBeInstanceOf(Error);
		expect(lostError).toBeTruthy();
		expect(observed).toBeTruthy();
		expect(
			(
				await f.app.query("SELECT name FROM tenancy.projects WHERE id=$1", [
					f.project.id,
				])
			).rows[0].name,
		).toBe("Protected");
	});
	it("denies malformed/unavailable FGA without turning errors into empty authorized lists", async () => {
		const f = await fixture();
		const broken = await proxy(async (_body, response) => {
			response.setHeader("content-type", "application/json");
			response.end("{}");
		});
		const authorization = createAuthorizationService({
			controlPool: f.reader,
			installationId: f.installation.env.INSTALLATION_ID,
			openfgaUrl: broken,
		});
		const resources = createResourceService(f.web, {
			authorize: authorization.authorizeResource,
			check: authorization.checkResource,
			checkBatch: authorization.checkResourceBatch,
			sourceCommit: authorization.sourceCommit,
		});
		await expect(resources.listProjects(f.owner, f.org)).rejects.toThrow();
		await expect(
			resources.getProject(f.owner, f.org, { id: f.project.id }),
		).rejects.toThrow();
	});
	it("explicitly upgrades the reviewed ready predecessor without changing epoch and safely resumes", async () => {
		const f = await fixture();
		const control = new Pool({ connectionString: f.installation.controlUrl });
		cleanup.push(() => control.end());
		const predecessor = JSON.parse(
			await readFile(
				new URL("./fixtures/phase2-model.json", import.meta.url),
				"utf8",
			),
		);
		expect(
			createHash("sha256").update(JSON.stringify(predecessor)).digest("hex"),
		).toBe(phase2ModelHash);
		const before = (await control.query("SELECT * FROM control.installations"))
			.rows[0];
		const receipt = await fgaRequest<{ authorization_model_id: string }>(
			f.installation.env.OPENFGA_API_URL,
			`/stores/${before.store_id}/authorization-models`,
			predecessor,
		);
		await control.query(
			"UPDATE control.installations SET model_id=$1,model_hash=$2",
			[receipt.authorization_model_id, phase2ModelHash],
		);
		await f.app.query(
			"UPDATE tenancy.authorization_revisions SET model_id=$1,model_hash=$2",
			[receipt.authorization_model_id, phase2ModelHash],
		);
		const options = {
			applicationPool: f.app,
			controlPool: control,
			installationId: f.installation.env.INSTALLATION_ID,
			openfgaUrl: f.installation.env.OPENFGA_API_URL,
		};
		await expect(bootstrap(options)).rejects.toThrow();
		await upgradeAuthorization(options);
		const after = (await control.query("SELECT * FROM control.installations"))
			.rows[0];
		expect(after.epoch).toBe(before.epoch);
		expect(after.model_hash).toBe(modelHash);
		await upgradeAuthorization(options);
		expect(
			(
				await control.query(
					"SELECT count(*)::integer AS count FROM control.security_events WHERE action='authorization.model_upgraded'",
				)
			).rows[0].count,
		).toBe(1);

		expect(
			(await f.resources.getProject(f.owner, f.org, { id: f.project.id })).id,
		).toBe(f.project.id);
		await control.query(
			"UPDATE control.installations SET model_id=$1,model_hash=$2",
			[receipt.authorization_model_id, phase2ModelHash],
		);
		await upgradeAuthorization(options);
		expect(
			(
				await control.query(
					"SELECT epoch,model_hash FROM control.installations",
				)
			).rows[0],
		).toEqual({ epoch: before.epoch, model_hash: modelHash });
		await control.query(
			"UPDATE control.installations SET model_id=$1,model_hash=$2",
			[receipt.authorization_model_id, phase2ModelHash],
		);
		await control.query("UPDATE control.model_upgrades SET completed_at=NULL");
		let changed = false;
		const interrupted = await proxy(async (body, response) => {
			if (!changed) {
				changed = true;
				await control.query(
					"UPDATE control.installations SET state='recovery_required'",
				);
			}
			const result = await fgaRequest(
				f.installation.env.OPENFGA_API_URL,
				`/stores/${before.store_id}/check`,
				body,
			);
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify(result));
		});
		await expect(
			upgradeAuthorization({ ...options, openfgaUrl: interrupted }),
		).rejects.toThrow("Independent publication changed");
		expect(
			(await control.query("SELECT completed_at FROM control.model_upgrades"))
				.rows[0].completed_at,
		).toBeNull();
		await expect(upgradeAuthorization(options)).rejects.toThrow();
	});
});
