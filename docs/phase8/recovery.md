# Phase 8 failure and restore verification

This lane implements P8-04 and expands `R-RECOVERY`. It reuses the production services, restricted runtime roles, independent control journal and existing real-service fixtures. Run it alongside Backoffice feature development with unique application/control databases, OpenFGA stores and storage buckets. No drill shuts down shared Compose services or resets ambient data.

## Declared local budget and fault boundaries

The diagnostic recovery budget is **60 seconds after the dependency returns or the replacement worker starts**. This budget is declared before the scenarios run. It is not a production recovery-time objective, a guarantee about external provider completion, or a backup retention claim. The worker records measured recovery milliseconds; integration assertions enforce the same budget for resumed restore, storage finalization and import replay.

Provider verification and bulk retry leases remain durable. Tests assert that work cannot retry early, then advance only the generated fixture's `nextCheckAt`/`available_at` timestamp rather than sleeping an hour. The budget therefore measures resumed processing after a retry becomes eligible, not the provider's outage duration or configured backoff. Existing FGA outage coverage retains its stronger 30-second local recovery assertion.

| Boundary | Executable evidence | Required result |
| --- | --- | --- |
| Real worker death before application effect, after committed effect but before queue acknowledgement, and after completed acknowledgement | `apps/worker/src/recovery.integration.test.ts`; `scripts/phase8/recovery.ts` repeats the same harness with `/app/dist/worker.mjs` from the exact customer image | SIGKILL really exits the process/container; abandoned claim retries within the budget and configured retry count; duplicate semantic delivery has one durable effect; completed claims do not restart |
| Storage unavailable, successful immutable write with lost response, physical deletion with lost response | `packages/db/src/files/service.integration.test.ts` | An actual refused S3 connection leaves staging unapproved; retry adopts the same immutable version, charges capacity once and records one availability audit; physical cleanup must be acknowledged before releasing allocation |
| Imported Project committed before bulk row receipt | `packages/db/src/bulk/service.integration.test.ts` | Retry keeps the durable operation key, reuses the Project, adds one row receipt and one creation audit; early retry is suppressed |
| Persistent export provider outage | Same bulk suite | Five failed eligible attempts reach terminal failure; repeated polling cannot add provider calls; expiration releases the reserved allocation once |
| Full `pg_dump`/`pg_restore` with post-backup deletions, transfer evidence and independent analytics mapping | `packages/db/src/lifecycle/restore.integration.test.ts` | Provider outage keeps readiness closed; independent mapping reconstitutes a suppressed subject absent from the backup; verification retries retain the accepted receipt; replay preserves invoice and append-only usage rows byte-for-byte at the SQL-value level |
| Restored security state | Restore and `packages/db/src/lifecycle/recovery.integration.test.ts` | Reads target the **restored** restricted-role services; deleted owner, transferred successor, revoked member and old API key remain denied; sessions/credentials/grants are invalidated; independent identity enrollment and owner recovery are required before current access |
| FGA loss, malformed/late responses and killed authorization transaction | `packages/authz/src/{authorization,resources,key-expiry,session-expiry}.integration.test.ts` | Every possible positive decision fails closed; late allows cannot commit writes after connection loss, revocation or expiry; dependency return does not restore obsolete grants |
| Billing/provider loss and late result after worker connection termination | `packages/db/src/billing/billing.integration.test.ts` | Preserve durable command/inbox state, provider key horizon, confirmed entitlement validity and exactly-once effects; pending inbox reconciles on restart |
| Uncertain late analytics ingestion, independent journal loss and provider erasure retry | `packages/db/src/analytics/service.integration.test.ts`, `packages/db/src/lifecycle/service.integration.test.ts` | Unsettled independent ingestion blocks erasure certification even if local attempts disappear; missing journal history fails against its retained head; provider receipt/retry state survives service recreation |

The worker's SQL barrier belongs only to its generated database. After SIGKILL, the harness terminates the exact worker backend waiting on that unique barrier before releasing it: PostgreSQL otherwise may not notice the closed client socket while its statement is blocked. This makes the before/after acknowledgement boundary deterministic. It does not grant administration privileges to the worker.

## Commands and evidence

Start the documented disposable dependencies first. The integration fixtures fail when services are absent. Run the cumulative fault suites from the repository root:

```sh
bun run test:integration apps/worker packages/authz/src/authorization.integration.test.ts packages/authz/src/resources.integration.test.ts packages/authz/src/key-expiry.integration.test.ts packages/authz/src/session-expiry.integration.test.ts packages/db/src/billing/billing.integration.test.ts packages/db/src/files/service.integration.test.ts packages/db/src/bulk/service.integration.test.ts packages/db/src/analytics/service.integration.test.ts packages/db/src/lifecycle packages/db/src/platform/service.integration.test.ts
```

After the exact candidate image is built, run:

```sh
node --import tsx scripts/phase8/recovery.ts
```

`TEST_IMAGE` selects the local image reference. The driver resolves its immutable digest, verifies both commit and source fingerprint, and runs its packaged worker as the image's restricted user with a read-only root and disposable `/tmp`. The shared P8-02 receipt interface writes a unique receipt for each success/failure; the successful receipt hashes the detailed timing artifact under `artifacts/phase8/recovery/`. Historical attempts are not overwritten. The driver uses the same local Compose network and fixtures as existing image acceptance.

Source-process integration does not stand in for exact-image evidence. The worker image scenario does not stand in for Commercial service/provider cases or full supervisor/HTTP image acceptance. Live provider retention/deletion guarantees, independent backup replication, real credential replacement and operator identity verification remain deployment obligations in [the recovery contract](../phase6/recovery.md). Backoffice BO-07 must separately exercise its image, version pairs and customer operation during Backoffice outage.

## Coordination

P8-04 depends on P8-02's receipt/source-image interface for its image command. Root command registration and CI invocation belong to P8-02/integration ownership. No application migration, tenant/operator model, production authorization boundary or domain event contract changes are required by these regressions. Backoffice can continue independently; it can reuse the worker/failure evidence only where its final source and runtime applicability are established.
