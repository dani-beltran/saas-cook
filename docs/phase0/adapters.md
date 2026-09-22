# ADR-0002: Billing, immutable storage and analytics adapters

Date: 2026-09-22. Status: interface decisions selected; 15 deterministic adapter feasibility tests pass; live provider certification remains pending. Sources were checked on this date. No provider account, paid contract, bucket, or analytics project has been provisioned by this decision.

## Billing and metered charging

Keep Stripe Billing/Checkout/Customer Portal for fixed and seat subscriptions. Use stripe 22.6.2 and pin the account API version and webhook endpoint version together during the Phase 5 test-account setup; the SDK's package version is not a substitute for that endpoint setting. Verify raw request bytes before parsing a webhook, persist a unique provider event in the inbox, acknowledge after persistence, and process asynchronously. Duplicate/out-of-order notifications and delivery retries are normal adapter inputs. [Stripe webhook contract](https://docs.stripe.com/webhooks).

`SubscriptionProvider` exposes checkout/portal session creation, subscription retrieval, a normalized signed event, cancellation and reconciliation. Every command carries an immutable local operation ID and environment/organization mapping. Its result distinguishes accepted, confirmed, rejected and unknown; timeouts never imply a confirmed change. Locally versioned confirmed entitlement sources drive access and shared seat admission. Stripe-side quantities, pending invoices and browser redirects never bypass those boundaries.

`UsageBillingProvider` exposes `deliver(events, operationId)`, `lookupDelivery`, `readUsageWindow`, and `adjust(originalId, adjustmentId, quantity)`. Events carry exact integer/decimal quantities, metric/version, occurred/received times and the charge-owner mapping. Local ledger uniqueness survives provider deduplication windows. Each contract item has one rating/invoicing owner: Stripe base/seat plus Metronome usage is permitted only when invoice integration assigns nonoverlapping line items. The same item cannot also enable Stripe usage metering.

Stripe's current guidance recommends Metronome for most new usage-based integrations, while retaining Billing Meters for existing integrations. This confirms the plan's interface boundary, rather than justifying a hard dependency on either remote meter API. [Stripe usage guidance](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage).

Decision: ship the local ledger/quotas and disabled/fake usage adapter first; use Metronome as the first optional commercial adapter candidate. A Billing Meters adapter is an explicit compatibility option, never silently substituted. Metronome access, negotiated price, event limits, deduplication horizon, correction windows, invoice integration and support obligations have not been established. They remain procurement/contract evidence needed before enabling external usage charging; no cost or throughput promise is inferred from marketing documentation. Commercial fixed/seat billing does not require optional metered charging.

Acceptance before enabling a provider: duplicate command after remote success/local timeout; event-ID and semantic duplicates; out-of-order cancellation/resubscription; final-seat races during provider downgrade; invoice-finalization corrections; same event retried beyond the remote dedup horizon; signed-event rejection; reconciliation against a real sandbox. Verify that a hybrid invoice contains each obligation once.

## Immutable-object contract

Decision: Amazon S3 is the reference private object implementation. “S3-compatible” is a protocol label, not evidence of the semantics below. The adapter must declare and test version-pinned source capture, immutable addressed reads, checksum verification, conditional creation, bounded multipart cleanup, retention and version-specific deletion. Local substitutes may exercise application flows but cannot certify cloud storage behavior.

```ts
type ObjectIdentity = {
  bucket: string;
  key: string;
  versionId: string; // required by the S3 reference adapter
  sha256: string;
  byteLength: number;
};
// Design contract: not a claim of an implemented production adapter.
interface ImmutableStorage {
  stage(attemptId: string, maxBytes: number): Promise<{ uploadUrl: string }>;
  capture(attemptId: string, sourceVersion: string): Promise<ObjectIdentity>;
  readExact(object: ObjectIdentity): Promise<ReadableStream<Uint8Array>>;
  removeExact(object: ObjectIdentity, deletionReceipt: string): Promise<void>;
}
```

1. The server creates an upload attempt and capacity reservation. Signed upload authorization reaches only a random private staging key with an expiry, constrained content length/checksum where supported, and no list/final-prefix permission. It carries no trusted tenant metadata from the client.
2. After upload, resolve one staged version and record it. The finalizer alone captures those exact bytes into a fresh random quarantine key with create-if-absent semantics and captures the returned destination version. Retries use the same attempt identity and compare the recorded digest/length/version. A conditional failure never silently chooses an unrelated object.
3. Compute SHA-256 and validate content type/size by reading the captured destination version; scan that same version. ETag is an opaque concurrency value, not a portable content hash. Persist the scan engine/version/result and its exact `ObjectIdentity`.
4. Recheck current resource permission, tenant lifecycle and reservation under the domain transaction; reacquire expired capacity; publish the captured identity and settle once with audit/outbox. “Finalization” changes metadata visibility; it never recopies mutable staging bytes after scanning.
5. Reads and short-lived downloads specify the recorded version and recheck current access. A new current version or delete marker cannot substitute different bytes. Deletion/retention jobs use separate privileges and delete the exact authorized versions; capacity is released only after the contract's counted state ends.

S3 supports conditional writes; their behavior includes precondition conflicts and special treatment of current delete markers in versioned buckets. Thus random keys plus a header alone are insufficient: pin the returned version and deny ordinary writers' final-version deletion. [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html). Object Lock protects a particular version; a new version or delete marker can still be created. Use version-specific reads regardless of whether retention locking is enabled. [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).

For ordinary user uploads, immutability means the committed byte identity cannot change while available. Keep versioning, restrictive IAM and exact reads; avoid imposing unconditional WORM retention on user content that must be erasable. Recovery receipts use separate retention-locked storage under [ADR-0003](recovery.md). A provider without version IDs is admissible only after proving an equivalent create-once namespace and no replacement/deletion privilege for upload/finalization identities; otherwise reject that adapter.

Required provider suite: overwrite staging during capture and after scan; replay upload URL; mutate current final key; concurrent finalizers; conditional conflict and ambiguous timeout; expired reservation plus competing capacity admission; checksum mismatch; scan rejection; source-version deletion; multipart abort/orphan reclamation; download after revocation/deletion; retry exact-version purge. Record IAM/bucket-policy fixtures, provider/version and request/response evidence. These live tests are Phase 6 acceptance and are not claimed passed here.

## Product analytics

Decision: collection is off without explicit configuration. Use a typed server dispatch boundary and posthog-node 5.52.5 as the reference candidate; disable automatic capture, session replay and browser-side authoritative attribution. A local test sink supports deterministic report and failure fixtures without credentials.

The domain event envelope is `{eventId, schemaVersion, eventName, occurredAt, organizationRef, scopedSubjectRef, preferenceVersion, properties}`. Server context supplies scope. Properties follow an event-specific allowlist; free text, email, names, auth URLs/tokens and resource content are forbidden. Every applicable deployment/organization/user preference must allow capture and current dispatch. A revoked preference suppresses queued retries. Use a dedicated bounded queue (default 10,000 events per environment, 24-hour expiry, 5-second dispatch timeout, 5 attempts); overflow/expiry increments diagnostics and drops optional analytics without blocking business/audit/billing work. Tune only with measured evidence.

Use an opaque random subject per `(user, organization)` plus a separate personal onboarding subject, tracked in a server-only mapping. Organization deletion removes only that organization's analytics subjects; global account deletion enumerates all of that user's scoped subjects. Never merge using email or use a shared global person profile for tenant events. Organization reports derive from the opaque organization property; publish the documented onboarding/activation/adoption/paid-conversion/weekly-retention definitions with UTC windows and explicit units/denominators.

PostHog exposes person lookup, bulk deletion and deletion-status APIs; its event APIs are separate. Existence of those endpoints does not establish an ordering barrier against an already dispatched event. [Person API](https://posthog.com/docs/api/persons), [event API](https://posthog.com/docs/api/events). Keep suppression receipts in the independent recovery journal and require these adapter operations: `capture`, `queryDelivery`, `deleteSubjects`, `queryDeletion` and an explicit documented late-arrival policy.

Deletion sequence: persist suppression, stop new claims for the subject, cancel queued events, resolve/drain claimed attempts, request person **and event** deletion, reconcile all scoped IDs, and retain a minimal receipt. A timeout remains ambiguous even after the local connection is closed. If the provider cannot prove remote completion under delayed arrivals, repeat deletion/reconciliation and leave status `provider-pending`. An observation delay by itself is not proof. The PostHog adapter must remain disabled for the release until its delayed-delivery/deletion contract is demonstrated; successful capture alone is insufficient.

Acceptance before enabling: two tabs switching organizations; report/cohort fixtures and corrections; replay IDs; preference changes between enqueue/retry; property redaction; disabled mode; overflow/outage isolation; tenant-scoped and global account erasure; deletion after backup plus late remote event. Retention, residency, operator access, deletion completion semantics and costs require a real provider project's settings/contract evidence. Those settings are unconfirmed at Phase 0, so this ADR selects a feasible integration boundary without reporting a live adapter as complete.

## Executed Phase 0 feasibility evidence

The [adapter spike](../../spikes/phase0/adapters/) uses the pinned AWS SDK command classes and Stripe webhook verifier. Run `node node_modules/vitest/vitest.mjs run spikes/phase0/adapters` from the repository root, or include it in `bun run phase0:test`. On 2026-09-22, **2 files / 15 tests passed** on Node 24.19.0 / Vitest 5.0.1, and the repository strict typecheck passed after these additions.

- Storage: pinned staging bytes survive overwrites before/during/after capture; returned destination version survives a newer current version; lost write acknowledgement reconciles without a second candidate; conflicting bytes/attempt are refused; scanning binds key/version/digest/length; 20 concurrent retries settle capacity/audit/outbox once; publication rejects changed authorization/lifecycle or unavailable expired capacity; rejected scans and oversized sources fail; empty/missing and S3 literal `null` version IDs are rejected.
- Stripe: actual SDK verifies a locally generated raw-body signature and rejects altered bytes, wrong secret and an expired timestamp. No Stripe API request or financial operation occurred.
- Analytics: injected transport demonstrates disabled mode, bounded/deduplicated queue, property allowlist, preference change before dispatch, tenant-scoped suppression, draining known in-flight delivery, expiry, timeout isolation and continued `provider-pending` status after ambiguous late delivery.

The S3 transport and finalization repository are explicit in-memory models; these results prove application command/identity logic, not provider IAM, actual S3 conditional/version semantics, SQL transaction isolation, malware detection, crash durability or production deletion. The capture fixture intentionally bounds objects at 10 MiB and does not implement multipart/presigned operations. Scan receipts and upload attempts are trusted server-internal values, never caller-supplied transport objects. Analytics Maps stand in for durable outbox/suppression records; the experiment does not call PostHog or prove its deletion barrier. Live-provider tests and the real transactional finalizer remain the later gates above.
