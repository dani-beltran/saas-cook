# PostHog deletion investigation — 2026-10-22

The original synthetic deletion remains provider-pending after **21.95 hours**. The live EU status API agrees with the application adapter. **M2 remains open.** No new subject, ingestion or deletion request was issued during this investigation.

The [sanitized evidence index](evidence/posthog-investigation-2026-10-22.json) includes the scoped responses, source fingerprints, pinned public provider source references and hashes of the retained probe source/results under ignored `artifacts/phase6-acceptance/posthog-investigation-2026-10-22/`.

## Demonstrated findings

| Check | Observation at 2026-10-22 10:00 UTC |
| --- | --- |
| Configuration | `https://eu.posthog.com`, project `314657`; the project's ingestion token matches the configured token. Credential values were neither printed nor retained. |
| Identity | Exact event UUID, synthetic distinct ID and person UUID match the original deletion receipt. |
| Deletion status | `status=all` and `status=pending` return the same single pending receipt; `status=completed` returns no receipt. `delete_verified_at` remains null. |
| Person profile | The scoped persons lookup returns no person. This does not establish event erasure. |
| Event | Independent UUID and distinct-ID queries, both forced fresh with `is_cached: false`, return the original event and its original person UUID. |
| Adapter | Observable ingestion is true; erasure is false, consistent with the raw provider responses. |
| Timing | The exposed event `created_at` is `2026-10-21T12:01:25.819Z`, before deletion request `12:02:58.050Z`. Occurrence time is `12:01:25.182Z`. Physical ClickHouse `inserted_at` is not established by this observation. |
| Scope | Only the original event was visible for the exact synthetic subject. No replacement subject or destructive retry was used. This does not prove the absence of an unobserved delayed write. |

The event is `503e1703-afb3-4809-9029-2aa0089d82c8`, the subject is `synthetic-acceptance-114c3509-44ad-4c7f-99c4-cba92192dce9`, and the person is `87ec1ed7-121e-5bf0-9489-70ad907e4e0b`. The provider receipt was created at `2026-10-21T12:02:58.165573Z`, matching the original request within 115 ms.

These checks narrow the cause: wrong project/token/region, wrong person identity and the earlier query-cache problem do not explain the observed pending status. No reproduced application defect explains this particular pending provider job, so the application, receipts and suppression behavior were left unchanged.

## Provider processing path and limits

PostHog [documents non-peak/weekend Cloud event deletion](https://posthog.com/docs/privacy/data-storage#asynchronous-data-deletion). Person-profile removal is separate from asynchronous event erasure. A weekday delay is therefore compatible with the published processing model; it is not evidence that an individual job will never complete.

The public provider source was inspected at commit `bc18825351e79476e830278a5cfea84d0b26676e`:

- [Person API](https://github.com/PostHog/posthog/blob/bc18825351e79476e830278a5cfea84d0b26676e/posthog/api/person.py) queues event deletion separately; deletion status derives from the stored verification timestamp.
- [Dagster deletion pipeline](https://github.com/PostHog/posthog/blob/bc18825351e79476e830278a5cfea84d0b26676e/posthog/dags/deletes.py) chains `run_deletes_after_squash` to `deletes_job`, waits for mutations, then runs `mark_deletions_verified`.
- [Override schedule](https://github.com/PostHog/posthog/blob/bc18825351e79476e830278a5cfea84d0b26676e/posthog/dags/person_overrides.py) gets its UTC cadence from deployment settings. The public pipeline references a weekly chain; this investigation cannot inspect the actual EU schedule, deployed revision or run history.
- The public person-deletion predicate bounds occurrence and physical insertion by the request time. The exposed HogQL `created_at` is useful evidence but does not prove the physical `inserted_at` value or deployed predicate. A completed receipt must still be paired with fresh event absence for release acceptance.

The leading explanation is waiting for the Cloud event-deletion chain. Queue backlog, an upstream failed run, mutation delay or verification failure remain possible until the provider confirms its actual deployed job state.

## Evidence gaps and diagnostic corrections

The original probe retained only the bulk deletion's HTTP `202`, not its JSON acknowledgement. `persons_found`, queued/deleted counts, event/recording queue flags and `deletion_errors` cannot be reconstructed. The matching live pending receipt independently proves an event-deletion record exists for this person; it does not recover the missing acknowledgement fields. The original script was preserved rather than rewritten.

This investigation's probe corrects the diagnostic coverage: it checks project/token correspondence, all three status filters, profile absence separately from event presence, two uncached event queries and exposed ingestion timing. It records bounded HTTP timing and allowlisted response metadata. No provider request/correlation ID was returned in the checked headers; only the Date header was available. Future live deletion probes should retain allowlisted acknowledgement fields before continuing and preserve the durable receipt across ambiguous responses. Do not resubmit this deletion merely to fill the historical evidence gap.

## Provider escalation draft — not sent

The next useful external step is to ask PostHog to confirm the EU processing window and the status of this exact queued deletion. No support message has been sent.

Include:

- EU project `314657`, the exact subject/person/event identifiers above, original acceptance time, and latest pending/empty-completed responses.
- The unchanged receipt timestamp, fresh-query proof of the surviving event and its exposed pre-request ingestion time.
- HTTP `200` diagnostics, original bulk `202`, sanitized Date headers and the explicit absence of retained acknowledgement JSON/correlation IDs.

Ask the provider:

1. Has this exact AsyncDeletion been selected by an EU deletion run? What is its next expected processing window?
2. What deployed schedule/revision applies, and did `squash_person_overrides` succeed and trigger `run_deletes_after_squash` / `deletes_job`?
3. If selected, are mutation waits or `mark_deletions_verified` blocked? Check every relevant events table and the physical `inserted_at` cutoff for this exact event.
4. If manual intervention is warranted, can the provider safely run its supported deletion procedure for the existing request without losing the original receipt/evidence?

Continue to report provider-pending. Require verified completion **and** a forced-fresh empty event query before starting the separate canonical live late/uncertain-ingestion drill. That drill remains unexecuted and blocked. Phase 7/8 and optional Backoffice are unaffected; no merge or scheduled follow-up is part of this investigation.

## Validation scope

The application implementation fingerprint remains `18515fc44a16fa34832990bea378b895ee7666cfc466a01f2848b7b8345d1dea`; no application, migration, evaluator-control or dependency change was made. Earlier test/build/image/performance evidence retains its exact recorded scope. This documentation/evidence update requires source-format, evidence-integrity and link checks, not redundant application or 30-minute performance reruns. The PR's normal CI will validate its new documentation commit.
