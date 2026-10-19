# Private text files

This is the implemented file slice of Phase 6. CSV bulk import/export jobs are still
required for the full `R-FILES` gate. Existing Phase 0 storage code remains historical
evidence; runtime uses `packages/db/src/files`.

## Configuration

Apply migrations through `0015` before starting the updated application. Files are
disabled unless `FILES_ENABLED=true`. Set `FILES_S3_BUCKET`, `FILES_S3_REGION`,
`FILES_S3_UPLOAD_KEY`/`FILES_S3_UPLOAD_SECRET` and
`FILES_S3_FINALIZER_KEY`/`FILES_S3_FINALIZER_SECRET` at runtime for web and worker.
`FILES_S3_ENDPOINT` is optional for a compatible provider; its configuration is
operator-owned. `FILES_CAPACITY_BYTES` defaults to 52,428,800. Existing organizations'
capacity buckets retain their established policy; changing the default does not
silently rewrite them. Physical allocation also obeys the configured ceiling.

Use a dedicated **private, versioning-enabled** bucket with public access blocked.
The uploader credential may only conditionally put objects under `staging/*`, with
no read, delete or finalized-namespace write permissions. The trusted finalizer may
read versions, put create-once `quarantine/*` objects, inspect bucket versioning and
list/delete versions for expiry. Restrict these IAM permissions to the dedicated
bucket. Upload CORS allows only the application origin, PUT and the signed
content-type/checksum/conditional headers. Neither browser receives a credential.
Tests use a disposable local bucket and explicitly synthetic, broader local roles;
they do not certify a deployment's cloud IAM or CORS policy.

[Conditional S3 writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
prevent reuse from overwriting a staging or captured key. The service additionally
pins the captured immutable version and verifies length/SHA-256 on every read.
[Presigned upload URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
are reusable until expiry, so URL expiry alone is not the integrity boundary.

## Supported behavior and bounds

- Human sessions only; immutable Project parent; current Project update for uploads
  and verification, current Project read for listing/download. Current authorization
  is checked again after external I/O and before transaction completion.
- `.txt` and CSV, valid UTF-8, 1 byte–1 MiB. `utf8-text-v1` rejects binary/invalid text,
  control characters and the EICAR test marker. It is a strict format validator,
  **not a general antivirus engine**. Binary, archive and active document formats
  require a separately reviewed scanner and are unsupported.
- Browser computes SHA-256. Five-minute staging URLs bind length/type/checksum and
  `If-None-Match: *`. Same-operation retries bind all input fields and reuse the
  same attempt. URL reissue ends 10 minutes after creation.
- Trusted capture reads a versioned source, writes a deterministic create-once
  quarantine object, verifies the resulting version and scans those exact bytes.
  Finalization records that identity with audit/outbox and capacity settlement.
  A lost acknowledgement resolves the same key and verifies its bytes; it cannot
  publish an unverified replacement.
- Storage reserves and charges both staging and captured copies. At most 100
  nondeleted attempts per organization; physical allocations remain bounded even
  when a reservation expires. Publication reacquires expired capacity. Concurrent
  finalization settles only once. Failed capture remains unavailable and charged
  until cleanup.
- Available files expire after 30 days; unfinished/rejected attempts after 20 minutes.
  Worker cleanup discovers at most five tenants and handles at most two files per
  tenant per minute. It removes both namespaces' versions and confirms absence
  before releasing allocation. Provider errors retain the allocation for retry.
- Downloads are bounded application responses followed by an attachment download;
  no reusable object URL is issued. Each request reads only the approved version,
  checks its digest and revalidates current access. A response already delivered
  cannot be recalled.

Payloads, object keys/versions, hashes and credentials are excluded from list DTOs,
audit and outbox. Storage outage does not affect ordinary Project CRUD or billing.
The cleanup timer is independent of critical billing delivery. An unavailable
storage adapter rejects file operations; it does not substitute in-memory storage.
