import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
	CreateBucketCommand,
	DeleteBucketCommand,
	GetObjectCommand,
	PutBucketVersioningCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { withTenantTransaction } from "../tenancy";
import { createFileService } from "./service";
import { type FileStorage, fileDigest, s3FileStorage } from "./storage";
import { pruneFiles } from "./worker";

let f: Awaited<ReturnType<typeof resourceFixture>>;
let owner: Awaited<ReturnType<typeof f.user>>, reader: typeof owner;
let org: string, other: string, project: string, readerMember: string;
let service: ReturnType<typeof createFileService>;
let storage: FileStorage;
const bucket = `files-${randomUUID()}`;
const s3 = new S3Client({
	endpoint: "http://127.0.0.1:19000",
	region: "us-east-1",
	forcePathStyle: true,
	credentials: {
		accessKeyId: "local_phase1",
		secretAccessKey: "local_phase1_storage",
	},
	maxAttempts: 1,
});
let bucketCreated = false;
const attempts: Array<{ org: string; id: string }> = [];
const bytes = Buffer.from("Approved document\n");
const input = () => ({
	projectId: project,
	operationKey: randomUUID(),
	name: "note.txt",
	contentType: "text/plain" as const,
	bytes: bytes.length,
	sha256: fileDigest(bytes),
});
async function upload(raw = input(), data = bytes) {
	const result = await service.initiate(owner, org, raw);
	attempts.push({ org, id: result.file.id });
	const response = await fetch(result.url, {
		method: "PUT",
		headers: result.headers,
		body: data,
	});
	expect(response.ok).toBe(true);
	return result;
}
beforeAll(async () => {
	f = await resourceFixture();
	[owner, reader] = await Promise.all([f.user(), f.user()]);
	for (const a of [owner, reader])
		a.assertCurrent = async () => new Date(Date.now() + 60000);
	org = (await f.organization(owner)).id;
	other = (await f.organization(owner)).id;
	readerMember = await f.member(owner, org, reader);
	project = (
		await f.resources.createProject(owner, org, {
			name: "Files",
			slug: "files",
			operationKey: randomUUID(),
		})
	).id;
	await s3.send(new CreateBucketCommand({ Bucket: bucket }));
	bucketCreated = true;
	await s3.send(
		new PutBucketVersioningCommand({
			Bucket: bucket,
			VersioningConfiguration: { Status: "Enabled" },
		}),
	);
	storage = s3FileStorage({ uploader: s3, finalizer: s3, bucket });
	service = createFileService(
		f.web,
		{ authorize: f.authorization.authorizeResource },
		{ storage, capacityBytes: 1048576 },
	);
});
afterAll(async () => {
	for (const a of attempts)
		await storage?.clearAttempt(
			`staging/${a.org}/${a.id}`,
			`quarantine/${a.org}/${a.id}`,
		);
	if (bucketCreated) await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
	s3.destroy();
	await f?.cleanup();
});
it("pins scanned versions across overwrite, concurrent finalization, replay and current permission", async () => {
	const raw = input(),
		attempt = await upload(raw);
	const id = attempt.file.id;
	expect((await service.initiate(owner, org, raw)).file.id).toBe(id);
	const duplicate = await fetch(attempt.url, {
		method: "PUT",
		headers: attempt.headers,
		body: bytes,
	});
	expect(duplicate.ok).toBe(false);
	const [first, replayed] = await Promise.all([
		service.finalize(owner, org, project, id),
		service.finalize(owner, org, project, id),
	]);
	expect(first).toEqual(replayed);
	expect(first.state).toBe("available");
	const charged = await f.app.query(
		"SELECT consumed,reserved FROM tenancy.capacity_buckets WHERE organization_id=$1 AND feature='files.bytes'",
		[org],
	);
	expect(charged.rows[0]).toEqual({ consumed: bytes.length * 2, reserved: 0 });
	// Even a privileged out-of-band overwrite cannot substitute a new version at download.
	for (const prefix of ["staging", "quarantine"])
		await s3.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: `${prefix}/${org}/${id}`,
				Body: Buffer.from("Unscanned replacement"),
			}),
		);
	expect(
		Buffer.from(
			(await service.download(owner, org, project, id)).base64,
			"base64",
		),
	).toEqual(bytes);
	await expect(service.download(owner, other, project, id)).rejects.toThrow();
	await expect(service.download(reader, org, project, id)).rejects.toThrow();
	const grant = await f.resources.grant(owner, org, {
		resourceId: project,
		subject: { kind: "membership", id: readerMember },
		relation: "viewer",
		operationKey: randomUUID(),
	});
	expect((await service.download(reader, org, project, id)).file.id).toBe(id);
	await f.resources.revokeGrant(owner, org, { grantId: grant.id });
	await expect(service.download(reader, org, project, id)).rejects.toThrow();
	expect((await f.web.query("SELECT * FROM tenancy.files")).rows).toEqual([]);
	await expect(
		withTenantTransaction(f.web, org, [owner.userId], false, (c) =>
			c.query("UPDATE tenancy.files SET project_id=$2 WHERE id=$1", [
				id,
				randomUUID(),
			]),
		),
	).rejects.toMatchObject({ code: "42501" });
	await expect(
		service.initiate(owner, org, { ...raw, name: "changed.txt" }),
	).rejects.toMatchObject({ code: "CONFLICT" });
});
it("rejects changed staging and unsupported bytes; reacquires expired reservation without duplicate settlement", async () => {
	const attempt = await upload();
	const id = attempt.file.id;
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `staging/${org}/${id}`,
			Body: Buffer.alloc(bytes.length, 0),
		}),
	);
	await expect(service.finalize(owner, org, project, id)).rejects.toThrow(
		"checksum mismatch",
	);
	await expect(service.download(owner, org, project, id)).rejects.toThrow();
	const invalid = Buffer.from([0, 1, 2]);
	const rejected = await upload(
		{ ...input(), bytes: invalid.length, sha256: fileDigest(invalid) },
		invalid,
	);
	expect(
		(await service.finalize(owner, org, project, rejected.file.id)).state,
	).toBe("rejected");
	await expect(
		service.download(owner, org, project, rejected.file.id),
	).rejects.toThrow();
	const retry = await upload();
	await f.app.query(
		"UPDATE tenancy.capacity_reservations SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=(SELECT reservation_id FROM tenancy.files WHERE id=$1)",
		[retry.file.id],
	);
	expect(
		(await service.finalize(owner, org, project, retry.file.id)).state,
	).toBe("available");
	const records = await f.app.query(
		"SELECT count(*)::int AS n FROM tenancy.audit_events WHERE action='file.available' AND target_id=$1",
		[retry.file.id],
	);
	expect(records.rows[0].n).toBe(1);
});
it("keeps physical staging allocation bounded and releases only after worker cleanup", async () => {
	const limited = createFileService(
		f.web,
		{ authorize: f.authorization.authorizeResource },
		{ storage, capacityBytes: 1 },
	);
	await expect(limited.initiate(owner, org, input())).rejects.toMatchObject({
		code: "CAPACITY",
	});
	await expect(
		f.web.query("SELECT * FROM tenancy.file_cleanup_due()"),
	).rejects.toMatchObject({ code: "42501" });
	const worker = new Pool({
		connectionString: f.installation.env.WORKER_DATABASE_URL,
	});
	try {
		await f.app.query(
			"UPDATE tenancy.files SET expires_at=now()-interval '1 minute' WHERE organization_id=$1",
			[org],
		);
		await expect(
			pruneFiles(worker, storage, async () => {
				throw new Error("closed");
			}),
		).rejects.toThrow("closed");
		for (let i = 0; i < 3; i++)
			await pruneFiles(worker, storage, f.authorization.publication);
		expect(
			(
				await f.app.query(
					"SELECT id FROM tenancy.files WHERE organization_id=$1 AND state<>'deleted'",
					[org],
				)
			).rows,
		).toEqual([]);
		expect(
			(
				await f.app.query(
					"SELECT consumed,reserved FROM tenancy.capacity_buckets WHERE organization_id=$1 AND feature='files.bytes'",
					[org],
				)
			).rows[0],
		).toEqual({ consumed: 0, reserved: 0 });
		await expect(
			s3.send(
				new GetObjectCommand({
					Bucket: bucket,
					Key: `quarantine/${org}/${attempts[0].id}`,
				}),
			),
		).rejects.toThrow();
	} finally {
		await worker.end();
	}
});
it("rejects disabled storage and expired final authorization", async () => {
	const disabled = createFileService(f.web, {
		authorize: f.authorization.authorizeResource,
	});
	await expect(disabled.initiate(owner, org, input())).rejects.toMatchObject({
		code: "DISABLED",
	});
	const expired = createFileService(
		f.web,
		{
			authorize: async (c, ...args) => {
				await f.authorization.authorizeResource(c, ...args);
				await c.query(
					"SELECT set_config('app.authorization_expires_at',(clock_timestamp()-interval '1 second')::text,true)",
				);
			},
		},
		{ storage },
	);
	await expect(expired.initiate(owner, org, input())).rejects.toThrow();
});

it("binds the scan to an immutable object even when staging and quarantine change during verification", async () => {
	const attempt = await upload();
	const changing = createFileService(
		f.web,
		{ authorize: f.authorization.authorizeResource },
		{
			storage: {
				...storage,
				read: async (object) => {
					const approved = await storage.read(object);
					for (const prefix of ["staging", "quarantine"])
						await s3.send(
							new PutObjectCommand({
								Bucket: bucket,
								Key: `${prefix}/${org}/${attempt.file.id}`,
								Body: Buffer.from("replacement during scan"),
							}),
						);
					return approved;
				},
			},
		},
	);
	expect(
		(await changing.finalize(owner, org, project, attempt.file.id)).state,
	).toBe("available");
	expect(
		Buffer.from(
			(await service.download(owner, org, project, attempt.file.id)).base64,
			"base64",
		),
	).toEqual(bytes);
});

it("denies a download whose file expires while the approved object is being read", async () => {
	const attempt = await upload();
	await service.finalize(owner, org, project, attempt.file.id);
	const row = (
		await f.app.query("SELECT object FROM tenancy.files WHERE id=$1", [
			attempt.file.id,
		])
	).rows[0];
	expect(row.object.scan).toEqual({ engine: "utf8-text-v1", verdict: "clean" });
	await f.app.query(
		"UPDATE tenancy.files SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",
		[attempt.file.id],
	);
	const slow = createFileService(
		f.web,
		{ authorize: f.authorization.authorizeResource },
		{
			storage: {
				...storage,
				read: async (object) => {
					const data = await storage.read(object);
					await delay(650);
					return data;
				},
			},
		},
	);
	await expect(
		slow.download(owner, org, project, attempt.file.id),
	).rejects.toThrow();
});
