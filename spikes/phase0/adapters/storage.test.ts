import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GetObjectCommand, PutObjectCommand,
  type GetObjectCommandOutput, type PutObjectCommandOutput,
} from '@aws-sdk/client-s3';
import {
  S3ImmutableCapture, finalize,
  type S3Transport, type UploadAttempt, type ObjectIdentity, type FinalizationRepository,
} from './storage';

type Version = { id: string; bytes: Buffer; metadata: Record<string, string> };
/** Explicit in-memory provider model; it is not evidence of real S3 behavior. */
class VersionedTransport implements S3Transport {
  versions = new Map<string, Version[]>();
  calls: (GetObjectCommand | PutObjectCommand)[] = [];
  loseNextPutAcknowledgement = false;
  reportedPutVersion: string | undefined | false = false;
  afterPinnedSourceRead?: () => void;
  beforeDestinationRead?: () => void;
  put(key: string, text: string | Buffer, metadata: Record<string, string> = {}): Version {
    const versions = this.versions.get(key) ?? [];
    const version = { id: `${key}-v${versions.length + 1}`, bytes: Buffer.from(text), metadata };
    versions.push(version);
    this.versions.set(key, versions);
    return version;
  }
  send(command: GetObjectCommand): Promise<GetObjectCommandOutput>;
  send(command: PutObjectCommand): Promise<PutObjectCommandOutput>;
  async send(command: GetObjectCommand | PutObjectCommand): Promise<GetObjectCommandOutput | PutObjectCommandOutput> {
    this.calls.push(command);
    const key = command.input.Key!;
    if (command instanceof PutObjectCommand) {
      if (command.input.IfNoneMatch !== '*') throw new Error('Missing conditional destination creation');
      if (this.versions.has(key)) throw new Error('412 Precondition Failed');
      const bytes = Buffer.from(command.input.Body as Uint8Array);
      expect(command.input.ChecksumSHA256).toBe(createHash('sha256').update(bytes).digest('base64'));
      const version = this.put(key, bytes, command.input.Metadata);
      if (this.loseNextPutAcknowledgement) {
        this.loseNextPutAcknowledgement = false;
        throw new Error('Connection lost after successful remote write');
      }
      return { VersionId: this.reportedPutVersion === false ? version.id : this.reportedPutVersion, $metadata: {} };
    }
    if (key.startsWith('quarantine/')) {
      const hook = this.beforeDestinationRead;
      this.beforeDestinationRead = undefined;
      hook?.();
    }
    const versions = this.versions.get(key) ?? [];
    const selected = command.input.VersionId
      ? versions.find((v) => v.id === command.input.VersionId)
      : versions.at(-1);
    if (!selected) throw new Error('NoSuchVersion');
    if (key.startsWith('staging/')) {
      const hook = this.afterPinnedSourceRead;
      this.afterPinnedSourceRead = undefined;
      hook?.();
    }
    return {
      VersionId: selected.id,
      ContentLength: selected.bytes.length,
      Metadata: selected.metadata,
      Body: Readable.from([selected.bytes]) as GetObjectCommandOutput['Body'],
      $metadata: {},
    };
  }
}

/** Test transaction model. Its synchronous commit section models the future locked SQL boundary. */
class AtomicRepository implements FinalizationRepository {
  private results = new Map<string, ObjectIdentity>();
  allowed = true;
  active = true;
  reservationExpiresAt = 100;
  now = 0;
  capacity = 100;
  reserved = 10;
  used = 0;
  auditCount = 0;
  outboxCount = 0;
  beforeCommit?: () => void;
  committed(id: string) { return Promise.resolve(this.results.get(id)); }
  async commitApproved(id: string, object: ObjectIdentity) {
    this.beforeCommit?.();
    this.beforeCommit = undefined;
    if (!this.allowed || !this.active) throw new Error('Current access or lifecycle denied');
    const existing = this.results.get(id);
    if (existing) return existing;
    const remainingReservation = this.now < this.reservationExpiresAt ? this.reserved : 0;
    if (this.used + Math.max(remainingReservation, object.byteLength) > this.capacity) {
      throw new Error('Cannot reacquire capacity');
    }
    this.used += object.byteLength;
    this.reserved = 0;
    this.results.set(id, object);
    this.auditCount++;
    this.outboxCount++;
    return object;
  }
}

function fixture() {
  const transport = new VersionedTransport();
  const source = transport.put('staging/attempt-1', 'clean');
  const attempt: UploadAttempt = {
    id: 'attempt-1', bucket: 'private-test', stagingKey: 'staging/attempt-1',
    sourceVersion: source.id, quarantineKey: 'quarantine/random-candidate-1', maxBytes: 10,
  };
  const capture = new S3ImmutableCapture(transport);
  return { transport, attempt, capture };
}

const cleanScanner = async () => ({ engine: 'fixture-scanner-v1', verdict: 'clean' as const });

describe('FILE-01 immutable capture application contract (injected S3 transport)', () => {
  it('rejects empty and S3 null versions at source, destination and exact-read boundaries', async () => {
    for (const versionId of ['', 'null']) {
      const { capture, attempt, transport } = fixture();
      await expect(capture.capture({ ...attempt, sourceVersion: versionId })).rejects.toThrow('upload attempt');
      expect(transport.calls).toHaveLength(0);
      await expect(capture.readExact({
        bucket: attempt.bucket, key: attempt.quarantineKey, versionId, byteLength: 5, sha256: 'unused',
      })).rejects.toThrow('immutable version');
      expect(transport.calls).toHaveLength(0);
    }
    for (const reportedVersion of ['', 'null', undefined]) {
      const { capture, attempt, transport } = fixture();
      transport.reportedPutVersion = reportedVersion;
      await expect(capture.capture(attempt)).rejects.toThrow('immutable version IDs');
    }
    const { capture, attempt, transport } = fixture();
    const unversioned = transport.put(attempt.quarantineKey, 'clean', { attempt: attempt.id });
    unversioned.id = 'null'; // Conflict reconciliation must reject the mutable null version too.
    await expect(capture.capture(attempt)).rejects.toThrow('immutable identity');
  });

  it('reads the pinned source despite staging overwrites before, during and after capture', async () => {
    const { transport, attempt, capture } = fixture();
    transport.put(attempt.stagingKey, 'bad-before');
    transport.afterPinnedSourceRead = () => { transport.put(attempt.stagingKey, 'bad-during'); };
    const object = await capture.capture(attempt);
    transport.put(attempt.stagingKey, 'bad-after');
    expect((await capture.readExact(object)).toString()).toBe('clean');
    expect(object.sha256).toBe(createHash('sha256').update('clean').digest('hex'));
    expect(transport.calls[0]).toBeInstanceOf(GetObjectCommand);
    expect(transport.calls[0]!.input).toMatchObject({ VersionId: attempt.sourceVersion });
  });

  it('pins returned destination version when a newer final-key version appears before verification', async () => {
    const { transport, attempt, capture } = fixture();
    transport.beforeDestinationRead = () => { transport.put(attempt.quarantineKey, 'malicious'); };
    const object = await capture.capture(attempt);
    expect(object.versionId).toContain('-v1');
    expect((await capture.readExact(object)).toString()).toBe('clean');
  });

  it('recovers an ambiguous remote success and repeats capture without creating a second version', async () => {
    const { transport, attempt, capture } = fixture();
    transport.loseNextPutAcknowledgement = true;
    const first = await capture.capture(attempt);
    const retried = await capture.capture(attempt);
    expect(retried).toEqual(first);
    expect(transport.versions.get(attempt.quarantineKey)).toHaveLength(1);
  });

  it('refuses a preexisting candidate belonging to another attempt or with different bytes', async () => {
    const { transport, attempt, capture } = fixture();
    transport.put(attempt.quarantineKey, 'unscanned', { attempt: attempt.id });
    await expect(capture.capture(attempt)).rejects.toThrow('Captured bytes differ');
    const other = fixture();
    other.transport.put(other.attempt.quarantineKey, 'clean', { attempt: 'someone-else' });
    await expect(other.capture.capture(other.attempt)).rejects.toThrow('immutable identity');
  });

  it('scans the captured bytes and refuses receipt reuse for a different key/version/digest/length', async () => {
    const { capture, attempt, transport } = fixture();
    const object = await capture.capture(attempt);
    const receipt = await capture.scan(object, async (bytes) => {
      expect(Buffer.from(bytes).toString()).toBe('clean');
      transport.put(attempt.quarantineKey, 'bad');
      return cleanScanner();
    });
    for (const altered of [
      { ...object, key: 'quarantine/other' }, { ...object, versionId: 'forged' },
      { ...object, sha256: 'forged' }, { ...object, byteLength: 99 },
    ]) {
      await expect(finalize(new AtomicRepository(), attempt.id, altered, receipt)).rejects.toThrow('exact immutable');
    }
    const repository = new AtomicRepository();
    await finalize(repository, attempt.id, object, receipt);
    expect((await capture.readExact(object)).toString()).toBe('clean');
  });

  it('settles capacity, audit and outbox exactly once under concurrent capture/finalize retries', async () => {
    const { capture, attempt, transport } = fixture();
    const repository = new AtomicRepository();
    const results = await Promise.all(Array.from({ length: 20 }, async () => {
      const object = await capture.capture(attempt);
      const receipt = await capture.scan(object, cleanScanner);
      return finalize(repository, attempt.id, object, receipt);
    }));
    expect(new Set(results.map((r) => r.versionId)).size).toBe(1);
    expect(transport.versions.get(attempt.quarantineKey)).toHaveLength(1);
    expect(repository.used).toBe(5);
    expect(repository.auditCount).toBe(1);
    expect(repository.outboxCount).toBe(1);
  });

  it('rechecks authorization/lifecycle and expired reservation at the publication boundary', async () => {
    const { capture, attempt } = fixture();
    const object = await capture.capture(attempt);
    const receipt = await capture.scan(object, cleanScanner);
    for (const mode of ['permission', 'lifecycle', 'capacity'] as const) {
      const repository = new AtomicRepository();
      repository.beforeCommit = () => {
        if (mode === 'permission') repository.allowed = false;
        if (mode === 'lifecycle') repository.active = false;
        if (mode === 'capacity') { repository.now = 101; repository.used = 98; }
      };
      await expect(finalize(repository, attempt.id, object, receipt)).rejects.toThrow();
      expect(await repository.committed(attempt.id)).toBeUndefined();
      expect(repository.auditCount).toBe(0);
    }
    const reacquired = new AtomicRepository();
    reacquired.now = 101;
    await finalize(reacquired, attempt.id, object, receipt);
    expect(reacquired.used).toBe(5);
  });

  it('denies rejected scans, oversize source and revoked access on finalization retry', async () => {
    const { capture, attempt, transport } = fixture();
    const object = await capture.capture(attempt);
    const rejected = await capture.scan(object, async () => ({ engine: 'scanner', verdict: 'rejected' }));
    await expect(finalize(new AtomicRepository(), attempt.id, object, rejected)).rejects.toThrow('clean scan');
    const oversized = transport.put(attempt.stagingKey, 'way too many bytes');
    await expect(capture.capture({ ...attempt, sourceVersion: oversized.id })).rejects.toThrow('upload limit');
    const repository = new AtomicRepository();
    const receipt = await capture.scan(object, cleanScanner);
    await finalize(repository, attempt.id, object, receipt);
    repository.allowed = false;
    await expect(finalize(repository, attempt.id, object, receipt)).rejects.toThrow('access');
    expect(repository.used).toBe(5);
  });
});
