import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import {
	createIdentityRuntime,
	type SessionIdentity,
} from "../../auth/src/index";
import { createResourceService } from "../../db/src/resources";
import { getPublication } from "./control";
import { fgaRequest } from "./fga";
import { createAuthorizationService } from "./index";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture() {
	const f = await resourceFixture({ poolSize: 1 });
	cleanup.push(f.cleanup);
	const owner = await f.user();
	const org = (await f.organization(owner)).id;
	const project = await f.resources.createProject(owner, org, {
		name: "Protected",
		slug: "protected",
		operationKey: randomUUID(),
	});
	const publication = await getPublication(
		f.reader,
		f.installation.env.INSTALLATION_ID,
	);
	const identity = createIdentityRuntime(f.identity, {
		secret: f.installation.env.AUTH_SECRET,
		origin: "https://auth.example.test",
		readiness: () =>
			getPublication(f.reader, f.installation.env.INSTALLATION_ID),
	});
	const session: SessionIdentity = {
		...owner,
		sessionId: randomUUID(),
		email: `${owner.userId}@example.test`,
		name: owner.userId,
		userVerified: true,
		credentialEpoch: 1,
		recoveryEpoch: publication.epoch,
		twoFactorEnabled: false,
	};
	// Seed a session through the restricted identity role; all checks below call
	// the production identity validator and real PostgreSQL/OpenFGA services.
	await f.identity.query(
		`INSERT INTO identity.session(id,user_id,token,expires_at,authentication_method,authenticated_at,user_verified,mfa,recovery_epoch)
		 VALUES($1,$2,$3,clock_timestamp()+interval '1 minute',$4,$5,true,true,$6)`,
		[
			session.sessionId,
			session.userId,
			randomUUID(),
			session.method,
			session.authenticatedAt,
			session.recoveryEpoch,
		],
	);
	const actor = {
		...session,
		assertCurrent: () => identity.assertCurrent(session),
	};
	async function expireSoon() {
		return (
			await f.identity.query<{ expires_at: Date }>(
				"UPDATE identity.session SET expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1 RETURNING expires_at",
				[session.sessionId],
			)
		).rows[0].expires_at;
	}
	return { ...f, owner, actor, org, project, publication, expireSoon };
}

describe("session expiry across protected resource transactions", () => {
	it.each(["get", "list"] as const)(
		"rejects a %s whose real OpenFGA allow arrives after the validated session expires",
		async (operation) => {
			const f = await fixture();
			let deadline: Date;
			let allowedProjectChecks = 0;
			const server = createServer(async (request, response) => {
				try {
					const chunks: Buffer[] = [];
					for await (const chunk of request) chunks.push(Buffer.from(chunk));
					const body = JSON.parse(Buffer.concat(chunks).toString());
					const result = await fgaRequest<{ allowed: boolean }>(
						f.installation.env.OPENFGA_API_URL,
						`/stores/${f.publication.storeId}/check`,
						body,
					);
					if (body.tuple_key.object.startsWith("project:")) {
						if (result.allowed) allowedProjectChecks++;
						await f.identity.query(
							"SELECT pg_sleep(greatest(0,extract(epoch FROM $1::timestamptz-clock_timestamp()))+0.03)",
							[deadline],
						);
					}
					response.setHeader("content-type", "application/json");
					response.end(JSON.stringify(result));
				} catch {
					response.writeHead(503).end();
				}
			});
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			cleanup.push(async () => {
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			});
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("Missing proxy address");
			const authorization = createAuthorizationService({
				controlPool: f.reader,
				installationId: f.installation.env.INSTALLATION_ID,
				openfgaUrl: `http://127.0.0.1:${address.port}`,
			});
			const resources = createResourceService(f.web, {
				authorize: authorization.authorizeResource,
				check: authorization.checkResource,
				checkBatch: authorization.checkResourceBatch,
				sourceCommit: authorization.sourceCommit,
			});
			deadline = await f.expireSoon();
			await expect(
				operation === "get"
					? resources.getProject(f.actor, f.org, { id: f.project.id })
					: resources.listProjects(f.actor, f.org, { limit: 20 }),
			).rejects.toThrow();
			expect(allowedProjectChecks).toBeGreaterThan(0);
			// A fresh operation on the same one-connection pool is still usable.
			expect(
				await f.resources.getProject(f.owner, f.org, { id: f.project.id }),
			).toMatchObject({ id: f.project.id });
		},
	);

	it("rolls back domain state, capacity, revision, audit and outbox after session expiry during later SQL", async () => {
		const f = await fixture();
		const snapshot = async () =>
			(
				await f.app.query(
					`SELECT
					 (SELECT count(*) FROM tenancy.projects WHERE organization_id=$1) AS projects,
					 (SELECT count(*) FROM tenancy.resource_registry WHERE organization_id=$1) AS resources,
					 (SELECT count(*) FROM tenancy.resource_grants WHERE organization_id=$1) AS grants,
					 (SELECT count(*) FROM tenancy.audit_events WHERE organization_id=$1) AS audit,
					 (SELECT count(*) FROM tenancy.outbox_events WHERE organization_id=$1) AS outbox,
					 (SELECT row_to_json(r) FROM tenancy.authorization_revisions r WHERE organization_id=$1) AS revision,
					 (SELECT json_agg(b ORDER BY b.id) FROM tenancy.capacity_buckets b WHERE organization_id=$1) AS capacity,
					 (SELECT count(*) FROM tenancy.capacity_reservations WHERE organization_id=$1) AS reservations`,
					[f.org],
				)
			).rows[0];
		const before = await snapshot();
		let deadline: Date;
		let wroteProject = false;
		const resources = createResourceService(f.web, {
			authorize: f.authorization.authorizeResource,
			check: f.authorization.checkResource,
			sourceCommit: async (client, organizationId) => {
				await f.authorization.sourceCommit(client, organizationId);
				wroteProject =
					(
						await client.query(
							"SELECT 1 FROM tenancy.projects WHERE organization_id=$1 AND slug='must-rollback'",
							[organizationId],
						)
					).rowCount === 1;
				await client.query(
					"SELECT pg_sleep(greatest(0,extract(epoch FROM $1::timestamptz-clock_timestamp()))+0.03)",
					[deadline],
				);
			},
		});
		deadline = await f.expireSoon();
		await expect(
			resources.createProject(f.actor, f.org, {
				name: "Must roll back",
				slug: "must-rollback",
				operationKey: randomUUID(),
			}),
		).rejects.toThrow("DENIED");
		expect(wroteProject).toBe(true);
		expect(await snapshot()).toEqual(before);
		expect(
			await f.resources.createProject(f.owner, f.org, {
				name: "Fresh operation",
				slug: "fresh-operation",
				operationKey: randomUUID(),
			}),
		).toMatchObject({ name: "Fresh operation" });
	});
});
