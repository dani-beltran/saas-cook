import { createHash } from 'node:crypto';
import {
  GetObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
  type PutObjectCommandOutput,
} from '@aws-sdk/client-s3';

/** Node/S3 command boundary. The production adapter can delegate each branch to S3Client.send. */
export interface S3Transport {
  send(command: GetObjectCommand): Promise<GetObjectCommandOutput>;
  send(command: PutObjectCommand): Promise<PutObjectCommandOutput>;
}

export type ObjectIdentity = Readonly<{
  bucket: string;
  key: string;
  versionId: string;
  sha256: string;
  byteLength: number;
}>;

export type UploadAttempt = Readonly<{
  id: string;
  bucket: string;
  stagingKey: string;
  sourceVersion: string;
  quarantineKey: string;
  maxBytes: number;
}>;

export type ScanReceipt = Readonly<{
  object: ObjectIdentity;
  engine: string;
  verdict: 'clean' | 'rejected';
}>;

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const immutableVersion = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value !== 'null';
const equalIdentity = (a: ObjectIdentity, b: ObjectIdentity) =>
  a.bucket === b.bucket && a.key === b.key && a.versionId === b.versionId &&
  a.sha256 === b.sha256 && a.byteLength === b.byteLength;

async function bytesOf(output: GetObjectCommandOutput, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 10 * 1024 * 1024) {
    throw new Error('The Phase 0 capture fixture is limited to 10 MiB');
  }
  if (output.ContentLength !== undefined && output.ContentLength > maxBytes) {
    throw new Error('Object exceeds reserved upload limit');
  }
  const body = output.Body;
  if (!body || !(Symbol.asyncIterator in body)) throw new Error('Expected Node streaming S3 body');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new Error('Object exceeds reserved upload limit');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/** Capture/download experiment: no presigning, cloud IAM, multipart, or durable SQL implementation. */
export class S3ImmutableCapture {
  constructor(private readonly s3: S3Transport) {}

  async capture(attempt: UploadAttempt): Promise<ObjectIdentity> {
    if (!immutableVersion(attempt.sourceVersion) || !attempt.stagingKey.startsWith('staging/') ||
        !attempt.quarantineKey.startsWith('quarantine/') || !attempt.id) {
      throw new Error('Invalid server-owned upload attempt');
    }
    const source = await this.s3.send(new GetObjectCommand({
      Bucket: attempt.bucket, Key: attempt.stagingKey, VersionId: attempt.sourceVersion,
    }));
    if (source.VersionId !== attempt.sourceVersion) throw new Error('Source version mismatch');
    const bytes = await bytesOf(source, attempt.maxBytes);
    const sha256 = digest(bytes);
    let versionId: string | undefined;
    let acknowledged = false;
    try {
      const written = await this.s3.send(new PutObjectCommand({
        Bucket: attempt.bucket,
        Key: attempt.quarantineKey,
        Body: bytes,
        IfNoneMatch: '*',
        ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
        Metadata: { attempt: attempt.id, sha256 },
      }));
      acknowledged = true;
      versionId = written.VersionId;
    } catch {
      // A lost acknowledgement and a conditional conflict both require reading and verifying.
      // Never create a fresh retry key or assume a timeout means the write did not happen.
    }
    if (acknowledged && !immutableVersion(versionId)) {
      throw new Error('Destination does not provide immutable version IDs');
    }
    const captured = await this.s3.send(new GetObjectCommand({
      Bucket: attempt.bucket, Key: attempt.quarantineKey,
      ...(versionId ? { VersionId: versionId } : {}),
    }));
    if (!immutableVersion(captured.VersionId) || captured.Metadata?.attempt !== attempt.id) {
      throw new Error('Cannot establish captured immutable identity');
    }
    if (versionId && captured.VersionId !== versionId) throw new Error('Destination version mismatch');
    const actual = await bytesOf(captured, attempt.maxBytes);
    if (actual.length !== bytes.length || digest(actual) !== sha256) {
      throw new Error('Captured bytes differ from the pinned source');
    }
    return Object.freeze({
      bucket: attempt.bucket, key: attempt.quarantineKey, versionId: captured.VersionId,
      sha256, byteLength: actual.length,
    });
  }

  async readExact(object: ObjectIdentity): Promise<Buffer> {
    if (!immutableVersion(object.versionId)) throw new Error('An immutable version ID is required');
    const output = await this.s3.send(new GetObjectCommand({
      Bucket: object.bucket, Key: object.key, VersionId: object.versionId,
    }));
    if (output.VersionId !== object.versionId) throw new Error('Read version mismatch');
    const bytes = await bytesOf(output, Math.max(1, object.byteLength));
    if (bytes.length !== object.byteLength || digest(bytes) !== object.sha256) {
      throw new Error('Immutable object integrity failure');
    }
    return bytes;
  }

  async scan(
    object: ObjectIdentity,
    scanner: (bytes: Uint8Array) => Promise<{ engine: string; verdict: 'clean' | 'rejected' }>,
  ): Promise<ScanReceipt> {
    const scannedObject = Object.freeze({ ...object });
    const bytes = await this.readExact(scannedObject);
    const result = await scanner(bytes);
    return Object.freeze({ object: scannedObject, ...result });
  }
}

/** Must be one SQL transaction: current authorization/lifecycle, reservation, identity, audit/outbox. */
export interface FinalizationRepository {
  committed(attemptId: string): Promise<ObjectIdentity | undefined>;
  commitApproved(attemptId: string, object: ObjectIdentity): Promise<ObjectIdentity>;
}

export async function finalize(
  repository: FinalizationRepository,
  attemptId: string,
  object: ObjectIdentity,
  receipt: ScanReceipt,
): Promise<ObjectIdentity> {
  if (receipt.verdict !== 'clean' || !receipt.engine || !equalIdentity(object, receipt.object)) {
    throw new Error('A clean scan of this exact immutable object is required');
  }
  // commitApproved, including retries, must validate current authorization before returning bytes.
  return repository.commitApproved(attemptId, object);
}
