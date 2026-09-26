import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
	CreateBucketCommand,
	DeleteBucketCommand,
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

async function waitFor(name: string, probe: () => Promise<void>) {
	const deadline = Date.now() + 45_000;
	while (true) {
		try {
			await probe();
			return;
		} catch {
			if (Date.now() > deadline)
				throw new Error(`Local service did not become ready: ${name}`);
		}
		await delay(500);
	}
}
async function http(url: string) {
	if (!(await fetch(url, { signal: AbortSignal.timeout(3000) })).ok)
		throw new Error("unready");
}
const s3 = new S3Client({
	endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:19000",
	region: "us-east-1",
	forcePathStyle: true,
	maxAttempts: 1,
	requestHandler: { connectionTimeout: 3000, requestTimeout: 3000 },
	credentials: {
		accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "local_phase1",
		secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "local_phase1_storage",
	},
});
const bucket = `phase1-readiness-${randomUUID()}`;
let created = false;
try {
	await Promise.all([
		waitFor("OpenFGA", () =>
			http(
				`${process.env.OPENFGA_API_URL ?? "http://127.0.0.1:18081"}/healthz`,
			),
		),
		waitFor("Mailpit", () =>
			http(`${process.env.MAILPIT_HTTP_URL ?? "http://127.0.0.1:8026"}/livez`),
		),
		waitFor("S3 writable volume", async () => {
			if (!created) {
				await s3.send(new CreateBucketCommand({ Bucket: bucket }));
				created = true;
			}
			await s3.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: "ready",
					Body: "synthetic readiness",
				}),
			);
		}),
	]);
	process.stdout.write(
		"Local PostgreSQL, OpenFGA, mail capture and writable S3 services are ready.\n",
	);
} finally {
	if (created) {
		await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: "ready" }));
		await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
	}
	s3.destroy();
}
