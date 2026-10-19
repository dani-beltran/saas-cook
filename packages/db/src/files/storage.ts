import { createHash } from "node:crypto";
import {
	DeleteObjectCommand,
	GetBucketVersioningCommand,
	GetObjectCommand,
	type GetObjectCommandOutput,
	ListObjectVersionsCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StoredObject {
	key: string;
	version: string;
	bytes: number;
	sha256: string;
}
export interface FileStorage {
	ready(): Promise<void>;
	writeExport?(key: string, bytes: Buffer): Promise<StoredObject>;
	upload(
		key: string,
		bytes: number,
		sha256: string,
		contentType: string,
	): Promise<string>;
	capture(
		stagingKey: string,
		destination: string,
		bytes: number,
		sha256: string,
	): Promise<StoredObject>;
	read(object: StoredObject): Promise<Buffer>;
	clearAttempt(stagingKey: string, quarantineKey: string): Promise<void>;
}
export const fileDigest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const version = (value: string | undefined): string => {
	if (!value || value === "null")
		throw new Error("Immutable storage version required");
	return value;
};
async function readBytes(output: GetObjectCommandOutput, length: number) {
	if (!output.Body || output.ContentLength !== length || length > 1048576)
		throw new Error("File length mismatch");
	const chunks: Buffer[] = [];
	let received = 0;
	for await (const chunk of output.Body as AsyncIterable<Uint8Array>) {
		received += chunk.length;
		if (received > length) throw new Error("File length exceeded");
		chunks.push(Buffer.from(chunk));
	}
	if (received !== length) throw new Error("File length mismatch");
	return Buffer.concat(chunks);
}
/** Versioned private S3 bucket. Upload signer and finalizer use separate IAM credentials. */
export function s3FileStorage(options: {
	uploader: S3Client;
	finalizer: S3Client;
	bucket: string;
}): FileStorage {
	const { uploader, finalizer, bucket } = options;
	const sendOptions = () => ({ abortSignal: AbortSignal.timeout(2500) });
	async function read(object: StoredObject) {
		const result = await finalizer.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: object.key,
				VersionId: version(object.version),
			}),
			sendOptions(),
		);
		if (result.VersionId !== object.version)
			throw new Error("File version mismatch");
		const data = await readBytes(result, object.bytes);
		if (fileDigest(data) !== object.sha256)
			throw new Error("File integrity mismatch");
		return data;
	}
	return {
		async ready() {
			const result = await finalizer.send(
				new GetBucketVersioningCommand({ Bucket: bucket }),
				sendOptions(),
			);
			if (result.Status !== "Enabled")
				throw new Error("Storage versioning must be enabled");
		},
		async upload(key, bytes, sha256, contentType) {
			if (!key.startsWith("staging/")) throw new Error("Staging key required");
			return getSignedUrl(
				uploader,
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					ContentLength: bytes,
					ContentType: contentType,
					ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
					IfNoneMatch: "*",
				}),
				{
					expiresIn: 300,
					signableHeaders: new Set([
						"content-length",
						"content-type",
						"if-none-match",
					]),
					unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
				},
			);
		},
		async capture(stagingKey, destination, bytes, sha256) {
			if (
				!stagingKey.startsWith("staging/") ||
				!destination.startsWith("quarantine/")
			)
				throw new Error("Invalid storage namespace");
			const staged = await finalizer.send(
				new GetObjectCommand({ Bucket: bucket, Key: stagingKey }),
				sendOptions(),
			);
			version(staged.VersionId);
			const data = await readBytes(staged, bytes);
			if (fileDigest(data) !== sha256)
				throw new Error("Uploaded checksum mismatch");
			let writtenVersion: string | undefined;
			try {
				const result = await finalizer.send(
					new PutObjectCommand({
						Bucket: bucket,
						Key: destination,
						Body: data,
						ContentType: "application/octet-stream",
						IfNoneMatch: "*",
						ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
					}),
					sendOptions(),
				);
				writtenVersion = version(result.VersionId);
			} catch {
				// A timeout can follow a committed write. Resolve the deterministic key and verify all bytes.
			}
			const captured = await finalizer.send(
				new GetObjectCommand({
					Bucket: bucket,
					Key: destination,
					...(writtenVersion ? { VersionId: writtenVersion } : {}),
				}),
				sendOptions(),
			);
			const object = {
				key: destination,
				version: version(captured.VersionId),
				bytes,
				sha256,
			};
			if (writtenVersion && writtenVersion !== object.version)
				throw new Error("Captured version mismatch");
			if (fileDigest(await readBytes(captured, bytes)) !== sha256)
				throw new Error("Captured checksum mismatch");
			return object;
		},
		async writeExport(key, bytes) {
			if (
				!/^quarantine\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key) ||
				bytes.length < 1 ||
				bytes.length > 1048576
			)
				throw new Error("Invalid export object");
			try {
				await finalizer.send(
					new PutObjectCommand({
						Bucket: bucket,
						Key: key,
						Body: bytes,
						ContentType: "application/octet-stream",
						IfNoneMatch: "*",
						ChecksumSHA256: Buffer.from(fileDigest(bytes), "hex").toString(
							"base64",
						),
					}),
					sendOptions(),
				);
			} catch (e) {
				if (
					!(
						e &&
						typeof e === "object" &&
						"$metadata" in e &&
						(e.$metadata as { httpStatusCode?: number }).httpStatusCode === 412
					)
				)
					throw e;
			}
			const captured = await finalizer.send(
				new GetObjectCommand({ Bucket: bucket, Key: key }),
				sendOptions(),
			);
			const object = {
				key,
				version: version(captured.VersionId),
				bytes: bytes.length,
				sha256: fileDigest(bytes),
			};
			if (fileDigest(await readBytes(captured, bytes.length)) !== object.sha256)
				throw new Error("Export identity conflict");
			return object;
		},
		read,
		async clearAttempt(stagingKey, quarantineKey) {
			for (const key of [stagingKey, quarantineKey]) {
				if (!/^(staging|quarantine)\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key))
					throw new Error("Invalid cleanup key");
				// Never remove a different key sharing the prefix. Bound all versions per pass.
				const listed = await finalizer.send(
					new ListObjectVersionsCommand({
						Bucket: bucket,
						Prefix: key,
						MaxKeys: 100,
					}),
					sendOptions(),
				);
				for (const object of [
					...(listed.Versions ?? []),
					...(listed.DeleteMarkers ?? []),
				]) {
					if (object.Key !== key) continue;
					await finalizer.send(
						new DeleteObjectCommand({
							Bucket: bucket,
							Key: key,
							VersionId: version(object.VersionId),
						}),
						sendOptions(),
					);
				}
				const remaining = await finalizer.send(
					new ListObjectVersionsCommand({
						Bucket: bucket,
						Prefix: key,
						MaxKeys: 1,
					}),
					sendOptions(),
				);
				if (
					remaining.IsTruncated ||
					remaining.Versions?.some((v) => v.Key === key) ||
					remaining.DeleteMarkers?.some((v) => v.Key === key)
				)
					throw new Error("Storage cleanup remains pending");
			}
		},
	};
}
/** The initial format validator accepts bounded UTF-8 text, excluding binary/control bytes. */
export function scanText(bytes: Uint8Array): {
	engine: string;
	verdict: "clean" | "rejected";
} {
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);

		let rejected = text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
		for (const character of text) {
			const code = character.charCodeAt(0);
			if (
				(code < 32 && code !== 9 && code !== 10 && code !== 13) ||
				code === 127
			) {
				rejected = true;
				break;
			}
		}
		return { engine: "utf8-text-v1", verdict: rejected ? "rejected" : "clean" };
	} catch {
		return { engine: "utf8-text-v1", verdict: "rejected" };
	}
}

export function configuredFileStorage(env: {
	FILES_ENABLED: string;
	FILES_S3_ENDPOINT?: string;
	FILES_S3_REGION: string;
	FILES_S3_BUCKET?: string;
	FILES_S3_UPLOAD_KEY?: string;
	FILES_S3_UPLOAD_SECRET?: string;
	FILES_S3_FINALIZER_KEY?: string;
	FILES_S3_FINALIZER_SECRET?: string;
}) {
	if (env.FILES_ENABLED !== "true") return undefined;
	if (
		!env.FILES_S3_BUCKET ||
		!env.FILES_S3_UPLOAD_KEY ||
		!env.FILES_S3_UPLOAD_SECRET ||
		!env.FILES_S3_FINALIZER_KEY ||
		!env.FILES_S3_FINALIZER_SECRET
	)
		throw new Error(
			"Enabled files require private versioned storage and separate upload/finalizer credentials",
		);
	const shared = {
		region: env.FILES_S3_REGION,
		endpoint: env.FILES_S3_ENDPOINT,
		forcePathStyle: !!env.FILES_S3_ENDPOINT,
		maxAttempts: 1,
	};
	return s3FileStorage({
		bucket: env.FILES_S3_BUCKET,
		uploader: new S3Client({
			...shared,
			credentials: {
				accessKeyId: env.FILES_S3_UPLOAD_KEY,
				secretAccessKey: env.FILES_S3_UPLOAD_SECRET,
			},
		}),
		finalizer: new S3Client({
			...shared,
			credentials: {
				accessKeyId: env.FILES_S3_FINALIZER_KEY,
				secretAccessKey: env.FILES_S3_FINALIZER_SECRET,
			},
		}),
	});
}
