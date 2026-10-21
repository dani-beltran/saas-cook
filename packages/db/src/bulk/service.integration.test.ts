import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { createTestFileStorage } from "../../../testing/src/file-storage";
import { createFileService } from "../files/service";
import { configuredFileStorage, fileDigest } from "../files/storage";
import { createResourceService } from "../resources";
import { createBulkService } from "./service";

let worker: Pool;
let f: Awaited<ReturnType<typeof resourceFixture>>,
	bucket: Awaited<ReturnType<typeof createTestFileStorage>>,
	service: ReturnType<typeof createBulkService>,
	files: ReturnType<typeof createFileService>;
let actor: Awaited<ReturnType<typeof f.user>> & {
		sessionId: string;
		recoveryEpoch: string;
	},
	org: string,
	other: string,
	parent: string,
	expired = false;
beforeAll(async () => {
	f = await resourceFixture({
		defaultProjectCapacity: 100,
		defaultProjectCreatesPerMonth: null,
	});
	bucket = await createTestFileStorage("http://localhost:3000");
	const owner = await f.user();
	const epoch = (
		await f.app.query("SELECT recovery_epoch FROM foundation.installation")
	).rows[0].recovery_epoch;
	actor = {
		...owner,
		sessionId: randomUUID(),
		recoveryEpoch: epoch,
		assertCurrent: async () => {
			if (expired) throw new Error("Session no longer active");
			return new Date(Date.now() + 60000);
		},
	};
	org = (await f.organization(actor)).id;
	other = (await f.organization(actor)).id;
	parent = (
		await f.resources.createProject(actor, org, {
			name: "Import source",
			slug: "import-source",
			operationKey: randomUUID(),
		})
	).id;
	const storage = configuredFileStorage(bucket.env);
	files = createFileService(
		f.web,
		{ authorize: f.authorization.authorizeResource },
		{ storage },
	);

	worker = new Pool({
		connectionString: f.installation.env.WORKER_DATABASE_URL,
	});
	const hooks = {
		authorize: f.authorization.authorizeResource,
		check: f.authorization.checkResource,
		checkBatch: f.authorization.checkResourceBatch,
		sourceCommit: f.authorization.sourceCommit,
	};
	const workerResources = createResourceService(worker, hooks, {
		cursorSecret: f.installation.env.AUTH_SECRET,
		defaultProjectCapacity: 100,
		defaultProjectCreatesPerMonth: null,
	});
	service = createBulkService(
		worker,
		{
			authorize: f.authorization.authorizeResource,
			check: f.authorization.checkResource,
			checkBatch: f.authorization.checkResourceBatch,
			sourceCommit: f.authorization.sourceCommit,
		},
		{
			secret: "synthetic-bulk-key-0000000000000000000",
			storage,
			files,
			resources: workerResources,
			ready: f.authorization.publication,
			resolveActor: async (session, user) => {
				if (session !== actor.sessionId || user !== actor.userId || expired)
					throw new Error("Session no longer active");
				return actor;
			},
			auditExport: async () => {
				throw new Error("Audit grant required");
			},
		},
	);
});
afterAll(async () => {
	await worker?.end();
	await bucket?.cleanup();
	await f?.cleanup();
});
it("dry runs mapped CSV, resumes chunk receipts and does not duplicate Projects", async () => {
	const csv = Buffer.from(
		"Title,Slug\n" +
			Array.from({ length: 25 }, (_, i) => `Imported ${i},import-${i}`).join(
				"\n",
			),
	);
	const upload = await files.initiate(actor, org, {
		projectId: parent,
		operationKey: randomUUID(),
		name: "import.csv",
		contentType: "text/csv",
		bytes: csv.length,
		sha256: fileDigest(csv),
	});
	expect(
		(
			await fetch(upload.url, {
				method: "PUT",
				headers: upload.headers,
				body: csv,
			})
		).ok,
	).toBe(true);
	await files.finalize(actor, org, parent, upload.file.id);
	const input = {
		kind: "projects.import" as const,
		operationKey: randomUUID(),
		projectId: parent,
		fileId: upload.file.id,
		mapping: { name: "Title", slug: "Slug" },
		duplicates: "skip" as const,
	};
	expect(
		(await service.dryRun(actor, org, input)).every(
			(r) => r.errors.length === 0,
		),
	).toBe(true);
	const job = await service.start(actor, org, input);
	expect((await service.start(actor, org, input)).id).toBe(job.id);
	await service.run(org, job.id);
	expect((await service.list(actor, org))[0]).toMatchObject({
		state: "running",
		progress: 20,
		total: 25,
	});
	await Promise.all([service.run(org, job.id), service.run(org, job.id)]);
	expect((await service.list(actor, org))[0]).toMatchObject({
		state: "complete",
		progress: 25,
	});
	await service.run(org, job.id);
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.projects WHERE organization_id=$1",
				[org],
			)
		).rows[0].n,
	).toBe(26);
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.bulk_rows WHERE job_id=$1",
				[job.id],
			)
		).rows[0].n,
	).toBe(25);
});
it("exports encrypted immutable bytes and rejects cross-tenant, changed-resource and expired-session download", async () => {
	const job = await service.start(actor, org, {
		kind: "projects.export",
		operationKey: randomUUID(),
	});
	await service.run(org, job.id);
	expect(
		(await service.list(actor, org)).find((j) => j.id === job.id)?.state,
	).toBe("complete");
	const download = await service.download(actor, org, job.id);
	expect(Buffer.from(download.base64, "base64").toString()).toContain(
		'"Imported 0"',
	);
	await expect(service.download(actor, other, job.id)).rejects.toThrow();
	expired = true;
	await expect(service.download(actor, org, job.id)).rejects.toThrow();
	expired = false;
	const p = await f.resources.getProject(actor, org, { id: parent });
	await f.resources.updateProject(actor, org, {
		id: parent,
		version: p.version,
		name: "Changed",
		description: "",
		status: "active",
	});
	await expect(service.download(actor, org, job.id)).rejects.toThrow();
	await f.app.query(
		"UPDATE tenancy.bulk_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",
		[job.id],
	);
	await service.run(org, job.id);
	expect(
		(
			await f.app.query(
				"SELECT state,object FROM tenancy.bulk_jobs WHERE id=$1",
				[job.id],
			)
		).rows[0],
	).toEqual({ state: "expired", object: null });
});
it("cancels queued work and rejects revoked actors before effects", async () => {
	const job = await service.start(actor, org, {
		kind: "projects.export",
		operationKey: randomUUID(),
	});
	await service.cancel(actor, org, job.id);
	await service.run(org, job.id);
	expect(
		(
			await f.app.query("SELECT state FROM tenancy.bulk_jobs WHERE id=$1", [
				job.id,
			])
		).rows[0].state,
	).toBe("expired");
	const blocked = await service.start(actor, org, {
		kind: "projects.export",
		operationKey: randomUUID(),
	});
	expired = true;
	await service.run(org, blocked.id);
	expired = false;
	expect(
		(await service.list(actor, org)).find((j) => j.id === blocked.id)?.state,
	).toBe("failed");
});
