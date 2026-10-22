# Product analytics

`ANALYTICS_ENABLED=false` by default. Configure the PostHog HTTPS host, project ID, ingestion token and a separate restricted query/person-deletion API key before enabling collection. Keep cleanup credentials configured after disabling collection. Automatic capture, replay, anonymous tracking and identity merging are absent. Operational/audit/usage records remain separate authorities.

## Catalogue and delivery

Version 1 accepts `account.signed_up`, `organization.created`, `onboarding.completed`, `core_action.completed`, `subscription.paid_started` and `subscription.paid_retracted`. The core-action feature is one of `projects`, `customers`, `files`, `imports`, `exports`. Signup and committed domain audit records feed a bounded source queue. Paid conversion requires a positive provider-confirmed paid invoice, excludes free/trial/checkout redirects and emits a correction when the final paid invoice is reclassified. Onboarding is an authenticated server acknowledgement with a stable per-user event ID.

Events carry only stable UUID, opaque scoped user/organization identifiers, catalogue/feature, timestamp, schema version and synthetic marker. No names, emails, free text, tokens, authentication URLs or resource contents leave the service. Source records contain identifiers/catalogue facts only, cap at 10,000 and expire after 24 hours. Capture requires application enablement plus the current user and applicable organization preferences; the same authoritative preference/lifecycle checks run at dispatch. `foundation.analytics_preferences` is the sole writable preference authority, with optimistic versions.

The delivery queue is bounded to 10,000 pending/uncertain events with a 24-hour unsent lifetime; each pass attempts at most ten. Confirmed/dropped local payloads and deduplication receipts expire after 90 days. Provider calls time out after three seconds. PostHog receives the stable event UUID; a successful ingestion HTTP response is insufficient: the adapter queries the event UUID with `refresh: "force_blocking"` and requires a fresh observable result. Cached query results cannot confirm ingestion because an earlier negative query may predate the event. Uncertain attempts are not blindly resent. Core sign-in, CRUD and billing commits do not wait for the provider.

The independent control store records subject mappings and ingestion attempts before external effects. These minimal receipts outlive application backups, so deleting or restoring local analytics rows cannot lose knowledge of a possibly late write. Deletion suppresses the subject, drops queued events, drains/resolves uncertain attempts, requests provider deletion and checks a confirmed completion record. A missing person or an unconfirmed/late event never counts as erasure. If an attempt cannot be resolved, cleanup remains pending. Replayed post-backup deletion reloads the independent mappings. Organization subjects are distinct from a user's personal and other-organization subjects.

PostHog protocol reference: [API overview](https://posthog.com/docs/api), [person API](https://posthog.com/docs/api/persons). Tests exercise bounded request/query/deletion responses and outage/late-ack behavior with an explicit protocol fixture; they are not live PostHog release evidence. An installation must validate its provider's deletion-status support before enabling this adapter for a release.

## Operator reports

`bun run analytics:report --start ISO --end ISO` uses only `PLATFORM_OPERATOR_DATABASE_URL`. The database function exposes bounded opaque analytical rows, not customer profile data. Version 1 reports UTC half-open windows of at most 90 days and refuses over 100,000 rows. Duplicate UUIDs and synthetic events are excluded. Reports use confirmed ingestions; at least the worker/ingestion delay applies, and opt-outs, expiry or outages can reduce the sample. They are analytical estimates, never billing/entitlement counters.

- **Onboarding:** distinct users who signed up in the selected window, and the subset with a recorded onboarding acknowledgement by its end. User-scoped identifiers preserve the denominator.
- **Activation:** organizations created in the window with a full seven-day observation period; numerator has a successful core action within seven days of creation.
- **Feature adoption:** distinct organizations per allowlisted feature per UTC Monday-based calendar week.
- **Paid conversion:** eligible organization creation cohort with a first positive paid invoice, after reclassification corrections. Free plans/trials do not qualify.
- **Retention:** the activated organization cohort, grouped by activation week; weeks 1–12 count later-week core activity only for cohorts with the entire observation week available. Empty denominators return null rates.

Account and organization settings call the same preferences service. No client-supplied business event or tenant ID is trusted as analytics authority.

## Durable erasure verification

The application worker resumes accepted receipts for pending suppressed subjects independently of collection and the parent lifecycle scan. Keep the worker, lifecycle-role database access, independent attempt registry and PostHog cleanup credentials available even when collection is disabled. A deletion request is asynchronous: the receipt/status stays pending while cleanup runs. This does not hold a browser request open or grant permission to resume collection.

Accepted receipts in `foundation.analytics_subjects.receipt` retain opaque subject, original person identities and request time. The optional `verification` object adds attempt count, latest check time/outcome, next check time, overdue marker and verified time. Existing receipts without this object remain readable and become due on their first worker pass; no migration or rewrite of applied history is needed. Provider checks back off for 1, 2, 4 and then 6 hours, with the next attempt persisted before network IO. A conditional update claims a due receipt across worker processes; a crashed process leaves a resumable scheduled attempt. A saved accepted receipt is reused, without repeating `bulk_delete` merely because verification is slow. Each verification scan selects at most ten due accepted-receipt groups; unresolved pre-submission subjects remain with the lifecycle retry/independent-ingestion barrier and cannot starve accepted receipts. The existing independent unresolved-ingestion barrier still precedes deletion: an acknowledgement, missing person, timeout or deadline never settles an uncertain write or certifies erasure.

Completion requires a matching provider `completed` record with `delete_verified_at` and a forced-blocking, uncached, finished query finding no event for the retained person identities or opaque subject. Older receipts use their person identities. A surviving event, cached/unfinished query, provider outage or missing receipt leaves the job pending. The verified timestamp is retained before the subject becomes complete. Local event payloads are removed only after verification.

After seven days from the accepted request, the worker persists `verification.alertedAt` and emits `worker.analytics_erasure_overdue` with an aggregate count, without subject identifiers or credentials. Configure production log alert routing and inspect pending rows using restricted lifecycle/operator access; the marker remains durable if the process exits before log delivery. Seven days is an escalation threshold, not a promise of provider processing time and never an automatic success/failure cutoff. Continue retries until verified or operator investigation resolves the provider issue. Example scoped operational inspection (use the lifecycle role, not the web role):

```sql
SELECT id, deletion_state, receipt->>'requestedAt' AS requested_at,
       receipt->'verification' AS verification
FROM foundation.analytics_subjects
WHERE deletion_state='pending'
ORDER BY receipt->>'requestedAt';
```

Application backup restoration still replays the independent deletion journal and subject/attempt registry before readiness. Application receipts/schedules can roll back with a backup; uncertain attempts cannot be assumed erased. Recovery must resolve provider identities/receipts before releasing pending cleanup. This environment does not establish independent-store retention, production worker uptime, alert delivery or provider physical/backup erasure guarantees.

### Historical acceptance subject

The original synthetic probe predates the application-owned subject queue. Its [manifest](evidence/posthog-erasure-subject.json) and ignored observations are retained as historical evidence. The last observation was pending, and erasure remains unverified.

The user [closed the manual follow-up](evidence/posthog-handoff-2026-10-22.json) and removed the dependent actual-provider late/uncertain-ingestion completion drill. PostHog owns execution of the submitted deletion. No further manual polling, new subject, or live drill is required; no recurring chat automation or historical-probe daemon exists. The standalone probe command remains available as a diagnostic utility, without an ongoing obligation to run it. Application-owned jobs continue to use the normal worker verification, suppression and retry behavior described above.
