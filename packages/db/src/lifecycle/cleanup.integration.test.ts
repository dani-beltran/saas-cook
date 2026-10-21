import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { appendDeletion } from "../../../authz/src/journal";
import { createTestFileStorage } from "../../../testing/src/file-storage";
import { createFileService } from "../files/service";
import { configuredFileStorage, fileDigest } from "../files/storage";
import { createDeletionCleanup } from "./cleanup";
import { advanceDeletion, createLifecycleService } from "./service";

it("purges real tenant content and credentials only after journaled cleanup; shared account content survives", async () => {
	const f = await resourceFixture();
	const url = new URL(f.installation.env.DATABASE_URL);
	url.username = "saas_cook_lifecycle";
	const lifecycle = new Pool({ connectionString: url.toString() });
	const w = new URL(f.installation.controlUrl);
	w.username = "saas_cook_journal_writer";
	const writer = new Pool({ connectionString: w.toString() });
	const storageFixture = await createTestFileStorage("http://localhost:3102");
	const storage = configuredFileStorage(storageFixture.env);
	if (!storage) throw new Error("Test storage required");
	try {
		const owner = await f.user();
		owner.assertCurrent = async () => new Date(Date.now() + 60000);
		const org = (await f.organization(owner)).id;
		const project = await f.resources.createProject(owner, org, {
			name: "Delete this content",
			slug: "delete-this",
			operationKey: randomUUID(),
		});

		const files = createFileService(
			f.web,
			{ authorize: f.authorization.authorizeResource },
			{ storage, capacityBytes: 1048576 },
		);
		const bytes = Buffer.from("pending deletion upload");
		const upload = await files.initiate(owner, org, {
			projectId: project.id,
			operationKey: randomUUID(),
			name: "pending.txt",
			contentType: "text/plain",
			bytes: bytes.length,
			sha256: fileDigest(bytes),
		});
		expect(
			(
				await fetch(upload.url, {
					method: "PUT",
					headers: upload.headers,
					body: bytes,
				})
			).ok,
		).toBe(true);
		const journal = {
			append: (key: string, record: Parameters<typeof appendDeletion>[3]) =>
				appendDeletion(writer, f.installation.env.INSTALLATION_ID, key, record),
		};
		const service = createLifecycleService(
			lifecycle,
			{
				authorize: f.authorization.authorizeResource,
				sourceCommit: f.authorization.sourceCommit,
			},
			{ secret: f.installation.env.AUTH_SECRET, journal },
		);
		const cleanup = createDeletionCleanup(lifecycle, {
			storage,
			analytics: { suppress: async () => true },
			sourceCommit: f.authorization.sourceCommit,
		});
		const request = await service.request(owner, {
			kind: "organization",
			organizationId: org,
			operationKey: randomUUID(),
		});
		await service.confirm(owner, request.id);
		await advanceDeletion(lifecycle, journal, cleanup, request.id);
		expect((await service.status(request.id, request.receipt)).state).toBe(
			"purging",
		);
		// The object stays create-once while its URL can still be valid.
		expect(
			(
				await fetch(upload.url, {
					method: "PUT",
					headers: upload.headers,
					body: bytes,
				})
			).ok,
		).toBe(false);
		await f.app.query(
			"UPDATE tenancy.files SET created_at=clock_timestamp()-interval '21 minutes' WHERE id=$1",
			[upload.file.id],
		);
		await advanceDeletion(lifecycle, journal, cleanup, request.id);
		expect((await service.status(request.id, request.receipt)).state).toBe(
			"complete",
		);
		expect(
			(
				await f.app.query(
					"SELECT * FROM tenancy.projects WHERE organization_id=$1",
					[org],
				)
			).rowCount,
		).toBe(0);
		expect(
			(
				await f.app.query(
					"SELECT name,status FROM tenancy.organizations WHERE id=$1",
					[org],
				)
			).rows[0],
		).toEqual({ name: "[deleted]", status: "suspended" });
		const personal = await service.request(owner, {
			kind: "account",
			operationKey: randomUUID(),
		});
		await service.confirm(owner, personal.id);
		await advanceDeletion(lifecycle, journal, cleanup, personal.id);
		expect((await service.status(personal.id, personal.receipt)).state).toBe(
			"complete",
		);
		expect(
			(
				await f.identity.query(
					'SELECT email,lifecycle_status FROM identity."user" WHERE id=$1',
					[owner.userId],
				)
			).rows[0],
		).toMatchObject({
			email: `${personal.id}@deleted.invalid`,
			lifecycle_status: "deleted",
		});
	} finally {
		await Promise.all([lifecycle.end(), writer.end()]);
		await storageFixture.cleanup();
		await f.cleanup();
	}
});
