import { randomUUID } from "node:crypto";
import {
	CreateBucketCommand,
	DeleteBucketCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { organizations } from "./index";

describe("disposable local service wiring", () => {
	it("round-trips synthetic objects for both organization fixtures through real S3", async () => {
		const client = new S3Client({
			endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:19000",
			region: "us-east-1",
			maxAttempts: 1,
			requestHandler: { requestTimeout: 5_000, connectionTimeout: 5_000 },
			forcePathStyle: true,
			credentials: {
				accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "local_phase1",
				secretAccessKey:
					process.env.S3_SECRET_ACCESS_KEY ?? "local_phase1_storage",
			},
		});
		const bucket = `phase1-test-${randomUUID()}`;
		const keys: string[] = [];
		let created = false;
		try {
			await client.send(new CreateBucketCommand({ Bucket: bucket }));
			created = true;
			for (const organization of organizations) {
				const key = `${organization.id}/synthetic.txt`;
				const body = `Synthetic object for ${organization.slug}`;
				await client.send(
					new PutObjectCommand({
						Bucket: bucket,
						Key: key,
						Body: body,
						ContentType: "text/plain",
					}),
				);
				keys.push(key);
				const object = await client.send(
					new GetObjectCommand({ Bucket: bucket, Key: key }),
				);
				expect(await object.Body?.transformToString()).toBe(body);
			}
		} finally {
			for (const key of keys)
				await client.send(
					new DeleteObjectCommand({ Bucket: bucket, Key: key }),
				);
			if (created)
				await client.send(new DeleteBucketCommand({ Bucket: bucket }));
			client.destroy();
		}
	});

	it("reaches local mail capture and OpenFGA health endpoints", async () => {
		const results = await Promise.all([
			fetch(
				`${process.env.MAILPIT_HTTP_URL ?? "http://127.0.0.1:8026"}/livez`,
				{ signal: AbortSignal.timeout(5_000) },
			),
			fetch(
				`${process.env.OPENFGA_API_URL ?? "http://127.0.0.1:18081"}/healthz`,
				{ signal: AbortSignal.timeout(5_000) },
			),
		]);
		for (const result of results) expect(result.status).toBe(200);
	});
});
