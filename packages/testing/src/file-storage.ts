import { randomUUID } from "node:crypto";
import {
	CreateBucketCommand,
	DeleteBucketCommand,
	DeleteObjectsCommand,
	ListObjectVersionsCommand,
	PutBucketCorsCommand,
	PutBucketVersioningCommand,
	S3Client,
} from "@aws-sdk/client-s3";
/**
 * Create an owned disposable bucket using fixed synthetic credentials.
 * @param origin Browser CORS origin for this fixture.
 * @param endpoint Optional explicit loopback HTTP endpoint for isolated service stacks.
 * @returns Restricted application configuration and cleanup for only the generated bucket.
 * Rejects remote/authenticated endpoints before network work; setup/cleanup service errors propagate.
 */
export async function createTestFileStorage(
	origin: string,
	endpoint = "http://127.0.0.1:19000",
) {
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		throw new Error("Test storage requires an explicit local HTTP endpoint");
	}
	if (
		parsed.protocol !== "http:" ||
		!["127.0.0.1", "localhost"].includes(parsed.hostname) ||
		!parsed.port ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== "/" ||
		parsed.search ||
		parsed.hash
	)
		throw new Error("Test storage requires an explicit local HTTP endpoint");
	const client = new S3Client({
		endpoint,
		region: "us-east-1",
		forcePathStyle: true,
		credentials: {
			accessKeyId: "local_phase1",
			secretAccessKey: "local_phase1_storage",
		},
		maxAttempts: 1,
	});
	const bucket = `files-browser-${randomUUID()}`;
	await client.send(new CreateBucketCommand({ Bucket: bucket }));
	async function cleanup() {
		try {
			for (let i = 0; i < 10; i++) {
				const listed = await client.send(
					new ListObjectVersionsCommand({ Bucket: bucket, MaxKeys: 1000 }),
				);
				const objects = [
					...(listed.Versions ?? []),
					...(listed.DeleteMarkers ?? []),
				].map((v) => ({ Key: v.Key, VersionId: v.VersionId }));
				if (!objects.length) break;
				const removed = await client.send(
					new DeleteObjectsCommand({
						Bucket: bucket,
						Delete: { Objects: objects },
					}),
				);
				if (removed.Errors?.length)
					throw new Error("Test object cleanup failed");
			}
			await client.send(new DeleteBucketCommand({ Bucket: bucket }));
		} finally {
			client.destroy();
		}
	}
	try {
		await client.send(
			new PutBucketVersioningCommand({
				Bucket: bucket,
				VersioningConfiguration: { Status: "Enabled" },
			}),
		);
		await client.send(
			new PutBucketCorsCommand({
				Bucket: bucket,
				CORSConfiguration: {
					CORSRules: [
						{
							AllowedOrigins: [origin],
							AllowedMethods: ["PUT"],
							AllowedHeaders: ["*"],
							MaxAgeSeconds: 60,
						},
					],
				},
			}),
		);
		return {
			cleanup,
			env: {
				FILES_ENABLED: "true",
				FILES_S3_ENDPOINT: endpoint,
				FILES_S3_REGION: "us-east-1",
				FILES_S3_BUCKET: bucket,
				FILES_S3_UPLOAD_KEY: "local_phase1",
				FILES_S3_UPLOAD_SECRET: "local_phase1_storage",
				FILES_S3_FINALIZER_KEY: "local_phase1",
				FILES_S3_FINALIZER_SECRET: "local_phase1_storage",
			},
		};
	} catch (error) {
		await cleanup();
		throw error;
	}
}
