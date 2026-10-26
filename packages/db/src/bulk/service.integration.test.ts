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
let loseCreateAcknowledgement = false;
let exportOutage = false;
let exportCalls = 0;
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
	const actualStorage = configuredFileStorage(bucket.env);
	if (!actualStorage) throw new Error("Disposable storage required");
	const storage = {
		...actualStorage,
		async writeExport(key: string, bytes: Buffer) {
			exportCalls++;
			if (exportOutage) throw new Error("Synthetic export storage outage");
			if (!actualStorage.writeExport)
				throw new Error("Export storage required");
			return actualStorage.writeExport(key, bytes);
		},
	};
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
			resources: {
				...workerResources,
				async createProject(...args) {
					const result = await workerResources.createProject(...args);
					if (loseCreateAcknowledgement) {
						loseCreateAcknowledgement = false;
						throw new Error("Synthetic lost create acknowledgement");
					}
					return result;
				},
			},
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

it("reconciles an import effect committed before its row receipt and honors the durable retry lease", async () => {
	const csv = Buffer.from(
		"Title,Slug\nCommitted before receipt,recovered-import\n",
	);
	const upload = await files.initiate(actor, org, {
		projectId: parent,
		operationKey: randomUUID(),
		name: "recovery.csv",
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
	const job = await service.start(actor, org, {
		kind: "projects.import",
		operationKey: randomUUID(),
		projectId: parent,
		fileId: upload.file.id,
		mapping: { name: "Title", slug: "Slug" },
		duplicates: "skip",
	});
	loseCreateAcknowledgement = true;
	await service.run(org, job.id);
	expect(
		(
			await f.app.query(
				"SELECT state,progress,attempts,available_at>now() AS delayed FROM tenancy.bulk_jobs WHERE id=$1",
				[job.id],
			)
		).rows[0],
	).toEqual({ state: "pending", progress: 0, attempts: 1, delayed: true });
	const project = (
		await f.app.query(
			"SELECT id FROM tenancy.projects WHERE organization_id=$1 AND slug='recovered-import'",
			[org],
		)
	).rows[0];
	expect(project).toBeDefined();
	expect(
		(
			await f.app.query("SELECT * FROM tenancy.bulk_rows WHERE job_id=$1", [
				job.id,
			])
		).rowCount,
	).toBe(0);
	await service.run(org, job.id);
	expect(
		(
			await f.app.query("SELECT attempts FROM tenancy.bulk_jobs WHERE id=$1", [
				job.id,
			])
		).rows[0].attempts,
	).toBe(1);
	const returnedAt = performance.now();
	await f.app.query(
		"UPDATE tenancy.bulk_jobs SET available_at=now() WHERE id=$1",
		[job.id],
	);
	await service.run(org, job.id);
	await service.run(org, job.id);
	expect(performance.now() - returnedAt).toBeLessThan(60_000);
	expect(
		(
			await f.app.query(
				"SELECT state,progress FROM tenancy.bulk_jobs WHERE id=$1",
				[job.id],
			)
		).rows[0],
	).toEqual({ state: "complete", progress: 1 });
	expect(
		(
			await f.app.query(
				"SELECT resource_id,state FROM tenancy.bulk_rows WHERE job_id=$1",
				[job.id],
			)
		).rows,
	).toEqual([{ resource_id: project.id, state: "created" }]);
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.audit_events WHERE target_id=$1 AND action='project.created'",
				[project.id],
			)
		).rows[0].n,
	).toBe(1);
});

it("bounds persistent export retries and releases allocation through expiry after dependency failure", async () => {
	const job = await service.start(actor, org, {
		kind: "projects.export",
		operationKey: randomUUID(),
	});
	const before = exportCalls;
	exportOutage = true;
	try {
		for (let attempt = 1; attempt <= 5; attempt++) {
			await f.app.query(
				"UPDATE tenancy.bulk_jobs SET available_at=now() WHERE id=$1",
				[job.id],
			);
			await service.run(org, job.id);
			expect(
				(
					await f.app.query(
						"SELECT state,attempts FROM tenancy.bulk_jobs WHERE id=$1",
						[job.id],
					)
				).rows[0],
			).toEqual({
				state: attempt < 5 ? "pending" : "failed",
				attempts: attempt,
			});
		}
		await service.run(org, job.id);
		expect(exportCalls - before).toBe(5);
	} finally {
		exportOutage = false;
	}
	await f.app.query(
		"UPDATE tenancy.bulk_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",
		[job.id],
	);
	await service.run(org, job.id);
	await service.run(org, job.id);
	expect(
		(
			await f.app.query(
				"SELECT j.state,r.state AS reservation_state FROM tenancy.bulk_jobs j JOIN tenancy.capacity_reservations r ON r.id=j.reservation_id WHERE j.id=$1",
				[job.id],
			)
		).rows[0],
	).toEqual({ state: "expired", reservation_state: "released" });
});
