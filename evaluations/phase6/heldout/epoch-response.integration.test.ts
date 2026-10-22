import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { createAuthorizationService } from "../../../packages/authz/src/index";
import { createResourceService } from "../../../packages/db/src/resources";
import { resourceFixture } from "../../../scripts/phase3/fixture";

it("phase6-task-04 denies a delayed old-epoch real FGA allow after independent recovery rotation", async () => {
	const f = await resourceFixture();
	const control = new Pool({ connectionString: f.installation.controlUrl });
	let signalReceived: () => void = () => {};
	let signalRelease: () => void = () => {};
	const received = new Promise<void>((resolve) => {
		signalReceived = resolve;
	});
	const release = new Promise<void>((resolve) => {
		signalRelease = resolve;
	});
	let realAllowed = false;
	const server = createServer(async (request, response) => {
		try {
			const body: Buffer[] = [];
			for await (const chunk of request) body.push(Buffer.from(chunk));
			const upstream = await fetch(
				`${f.installation.env.OPENFGA_API_URL}${request.url}`,
				{
					method: request.method,
					headers: { "content-type": "application/json" },
					body: ["GET", "HEAD"].includes(request.method ?? "GET")
						? undefined
						: Buffer.concat(body),
					signal: AbortSignal.timeout(5000),
				},
			);
			const text = await upstream.text();
			if (request.url?.endsWith("/check")) {
				realAllowed = JSON.parse(text).allowed === true;
				signalReceived();
				await release;
			}
			response.writeHead(upstream.status, {
				"content-type": "application/json",
			});
			response.end(text);
		} catch {
			response.writeHead(503);
			response.end("{}");
			signalReceived();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const actor = await f.user();
		actor.assertCurrent = async () => new Date(Date.now() + 60000);
		const org = (await f.organization(actor)).id;
		const project = await f.resources.createProject(actor, org, {
			name: "Epoch barrier",
			slug: "epoch-barrier",
			operationKey: randomUUID(),
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing proxy");
		const auth = createAuthorizationService({
			controlPool: f.reader,
			installationId: f.installation.env.INSTALLATION_ID,
			openfgaUrl: `http://127.0.0.1:${address.port}`,
		});
		const resources = createResourceService(f.web, {
			authorize: auth.authorizeResource,
			check: auth.checkResource,
			checkBatch: auth.checkResourceBatch,
			sourceCommit: auth.sourceCommit,
		});
		const pending = resources.getProject(actor, org, { id: project.id });
		await received;
		expect(realAllowed).toBe(true);
		await control.query(
			"UPDATE control.installations SET epoch=$2,state='recovery_required' WHERE installation_id=$1",
			[f.installation.env.INSTALLATION_ID, randomUUID()],
		);
		signalRelease();
		await expect(pending).rejects.toThrow();
	} finally {
		signalRelease();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await control.end();
		await f.cleanup();
	}
}, 30000);
