# ADR-0003: Independent recovery authority and security revalidation

Date: 2026-09-22. Status: application contract selected; implementation and synthetic recovery tests remain planned. Implements the design decision required by Phase 0; [operations §4.8](../04-billing-usage-operations.md#recovery-readiness-protocol) remains the canonical restore procedure.

## Application recovery boundary

The recovery journal and epoch/readiness state must remain authoritative across application and OpenFGA database restores. The application principal can submit lifecycle intents and read scoped readiness, but cannot issue recovery approvals, delete journal records or reopen gates. This is an application access-control contract; infrastructure and operator arrangements are outside the template scope.

The adapter must verify journal completeness and current authority independently of the restored snapshot. Missing evidence keeps affected access closed. Provider selection and operational recovery promises are not Phase 0 gates.

## Journal and completeness protocol

The independent service stores a versioned, minimal event: environment/installation ID, monotonically assigned sequence, request ID, subject type/opaque subject ID, lifecycle decision/effective date, retention scope, accepted ownership-resolution receipts, provider cleanup obligations, previous hash, payload hash and signer key ID. Store references/digests to sealed evidence; never put passwords, passkeys, magic-link secrets or unnecessary profile data into immutable records. Account subjects are global; organization subjects remain tenant scoped.

Proposed append protocol:

1. Application commits a frozen local intent; it cannot promise deletion scheduled or start purge yet. It submits the same request ID on retries.
2. The recovery service atomically inserts an immutable event and request-ID mapping and advances its sequencer using atomic conditional transactions. The transaction checks the current installation/epoch and that append admission is open; closing the recovery barrier serializes against this same sequencer/control item. Duplicate ID with a different payload is rejected. Use a durable deduplication item rather than relying on the API's short idempotency-token window. The adapter must retain idempotency mappings for the supported retry window.
3. Write that canonical signed event to unique immutable versioned keys in the journal adapter. Apply the approved retention lock and verify exact versions/checksums. Existing content must match exactly on retry. A crash at any step leaves a repairable unacknowledged append; the service repairs gaps from its immutable event records. Never skip an allocated sequence or turn a missing event into an empty success.
4. Advance a contiguous durable watermark only after all preceding objects are verified in the journal adapter. Persist a signed immutable checkpoint containing that watermark/hash in the journal adapter, then return the receipt. Concurrent appends use conditional head updates; a recovered head never moves backwards. A journal head restored from backup is not sufficient completeness evidence: reconcile it with the authoritative checkpoint chain before serving.
5. Application records the receipt and only then exposes scheduled status. Purge/completion, allowed organization cancellation, retention change and analytics suppression append further events; receipt retries do not undo accepted ownership transfers or duplicate provider effects.

Journal references include version IDs and digests; reads verify signatures and chains. The adapter must preserve acknowledged records for the supported replay horizon and reject mutation of retained evidence.

Completeness means every sequence through the signed durable watermark is present and verified, the latest authoritative head/checkpoint is known, and no accepted intent is stranded behind it. Listing a bucket, matching application row counts, or having a valid prefix of hashes cannot prove that the newest event is included. Before restoring service, reconcile pending appends and obtain a current checkpoint from the live authority. If the authority is lost/unverifiable, keep gates closed while custodians recover and attest a complete successor. No “initialize empty journal” fallback exists.

## Epoch and readiness barrier

An explicit fresh installation records a new environment/installation identity and empty-data attestation. Missing evidence means investigation/recovery, never automatic bootstrap. A recovery begins by closing readiness and revoking old process/provider credentials. The recovery authority allocates a fresh random epoch and monotonic counter; old epochs cannot issue current effects even if their application database is restored later.

Control state includes `{installationId, epoch, counter, state, journalWatermark, modelHash, approvedOrganizations, evidenceHash}`. `state` progresses closed → replaying → revalidating → rebuilding → verified → ready through conditional updates. Failures keep it closed. Only recovery services can approve transitions; the runtime reads the current epoch on protected operations and worker dispatch and fails closed when it cannot verify it. Cached readiness alone cannot authorize continued side effects after a gate closure. Before state changes or restoration, fence/drain old processes and revoke their credentials so an in-flight check cannot act across the transition.

During final replay, acquire a recovery-service barrier that **fences append admission and new sequence allocation/commit**, not only acknowledgements. The barrier transition and each append transaction serialize on the same control/sequencer item: a request is either committed before the barrier and included in the accepted tail, or refused/pending without a sequence or receipt. This closes the race in which an unacknowledged but already accepted event could otherwise fall beyond a captured watermark.

With append admission closed, record the last allocated sequence as the immutable barrier target. Drain/repair every already accepted append through that target, verify journal contents and a signed contiguous checkpoint, and replay every event through it. Do not release readiness while an allocated event is unarchived, unverified or absent from the restored state. A timed-out caller does not remove an accepted event from this obligation. Receipt delivery for an accepted event may resume only after replay proves its lifecycle restrictions in the current epoch.

Conditional readiness release checks the same epoch, barrier token, sequencer target and durable watermark, plus graph manifests and revalidation evidence. Install the new runtime's gate before reopening append admission. Requests held outside the barrier remain pending with no receipt, no purge and no scheduled-success claim; a local freeze stays in place where it still exists. After release, accept a request only with the current epoch, freshly verified authorization/lifecycle state and a current-epoch local frozen intent. A pre-restore local intent/old worker cannot obtain a delayed receipt that bypasses the restored lifecycle state. Normal deletion commands again freeze before appending and acknowledge only after the independent receipt.

An interrupted barrier remains closed and requires reconciliation; lease expiry never automatically reopens append admission or readiness. Test append commit versus barrier acquisition, an already accepted but unarchived tail, delayed receipt delivery, and a pending request crossing epochs. This is a proposed concurrency/crash protocol, not executed recovery evidence. The canonical [recovery procedure](../04-billing-usage-operations.md#recovery-readiness-protocol) and [lifecycle lock order](../03-data-model.md#canonical-lifecycle-lock-order) continue to govern local freeze/re-admission.

## Identity and access revalidation

An application restore invalidates all saved sessions, API keys, support sessions, challenges, passwords/passkeys, MFA recovery material and linked-provider credentials. Rotate integration secrets before external effects. A restored credential, restored email address, or successful login with either proves nothing about current authorization.

Recover organizational authority using current, pre-enrolled evidence held outside the restored snapshot: an independently controlled enterprise directory for the scopes it owns, or recovery reviewers checking independently enrolled organization contacts and authority records. Email to an address found only in the snapshot is rejected. Directory authentication is insufficient to re-create application-specific roles/grants not owned by that directory.

Issue a scoped, short-lived recovery capability bound to the fresh epoch after verification. A verified owner reviews current members, teams, grants/parent relationships and tenant security policy through recovery services; a content hash binds the approval to the exact proposed configuration and source revisions. Changes invalidate that approval. Re-enroll credentials into the fresh epoch; re-admit members through normal seat admission; rebuild FGA only from approved relationships. Unknown organizations remain in owner recovery while verified organizations can reopen after application-wide replay succeeds. Security policy is not weakened to accelerate recovery.

For FGA-only restoration, use the less disruptive path only after independently attesting that the application store and security state are current/intact; bind that evidence to the new epoch and rebuild fresh graph namespaces. Uncertain recovery points use full revalidation. Accepted ownership transfer receipts do not automatically validate the successor: a deprovisioned/unverified successor keeps the organization gated.

## Template acceptance

Phase 0 defines the application protocol; Phase 6 implements it and tests mismatched snapshots, post-backup deletion/transfer/revocation, credential replacement, incomplete journals, interrupted appends, stale epochs, unavailable authority and denied unverified organizations. Retain evidence of application allow/deny behavior and replay completeness.

Infrastructure operation, named recovery owners, backup schedules and recovery-time commitments are outside this template. The image exposes the application commands and adapter interfaces needed to enforce its security invariants.
