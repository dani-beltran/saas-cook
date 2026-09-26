# ADR P0-AUTHZ-2: authoritative source with request-local OpenFGA contexts

Date: 2026-09-23. Scope: the Phase 0 human/team/workspace/project policy. The rejected full-copy candidate and all of its failure evidence remain in [ADR P0-AUTHZ](authorization.md).

**Decision: accept the contextual candidate for the bounded Phase 0 authorization gate.** Replace asynchronous full-organization graph publication with a bounded, authoritative PostgreSQL context for each OpenFGA authorization query. Keep the original availability, latency, revocation and recovery requirements. The full reference run and fault suite passed; production integration and the separate Phase 0 operational commitments remain open.

## Problem and change

Copying the entire organization for every create, grant, revocation or parent move made ordinary requests unavailable while a replacement graph was pending. It also generated obsolete remote relationships and change history faster than cleanup handled them. Compacting retired snapshots fixed one local retention defect but could not fix that publication design.

The replacement stores permission relationships only in the authoritative application database. A protected transaction reads the small policy closure relevant to its actor and candidate resources, then submits it as OpenFGA contextual tuples. These tuples exist only for the authorization query; they are not persisted. OpenFGA continues to evaluate all possible positive decisions using the existing model. [OpenFGA contextual tuples](https://openfga.dev/docs/interacting/contextual-tuples)

Implementation: [contextual.ts](../../spikes/phase0/authz/contextual.ts), [contextual fault/policy tests](../../spikes/phase0/authz/contextual.test.ts), and the shared [benchmark](../../spikes/phase0/authz/benchmark.ts).

## Consistency and failure contract

1. PostgreSQL remains authoritative for resource grants/parents, organization membership and team membership. Register resources and change grants in the same transaction. The source commit advances desired and applied revisions together: there is no asynchronous publication gap. The spike retains an already-applied diagnostic journal entry for each source change; it is not a remote projection queue.
2. Keep the lifecycle-user-before-organization lock order. Reads and ordinary updates hold the shared organization fence across source reads, OpenFGA evaluation, domain SQL and commit. Authorization changes first obtain a real decision in a separate read-only shared-fence transaction. The mutating transaction acquires the exclusive fence from its start, reconstructs the complete context and rechecks membership/readiness. It can reuse only this invocation’s decision when every source field, actor, permission, object, model and epoch matches, and no condition expiry has elapsed; otherwise it evaluates again. Unrelated source revisions do not invalidate identical inputs. The earlier transaction must commit successfully before its result is eligible for revalidation. There is no lock upgrade or reusable client capability.
3. Check current local membership and its database-server-time expiry, recovery readiness, evaluation mode, revision equality, and the exact pinned model. Context compilation is specific to that model; introducing a different policy model requires a matching compiler and parity tests. Legacy projection workers cannot prepare or publish attempts for contextual tenants.
4. Every authorization batch uses a fresh random namespace qualified by organization and recovery epoch. All non-principal object references and team usersets use the same request namespace. Stable user IDs remain subject to local membership checks. Requests do not reuse another request's namespace, cached grant decisions, or stored projection generations.
5. Use OpenFGA Check for one possible positive candidate and BatchCheck for several, with `HIGHER_CONSISTENCY` and the pinned model. A missing/error result or dependency timeout fails closed. A source-side negative filter may rule out candidates with no possible admin/manager/viewer path in the pinned model; it cannot grant access. Possible grants, including conditional and inherited grants, always reach OpenFGA.
6. Revocation becomes effective at source commit. Earlier fenced operations must drain first. A later request sees the new source immediately. A remote write arriving in an older namespace has no effect on a new request. If the database connection is lost while an allowed response is pending, the old transaction cannot commit protected SQL; an HTTP response alone is not an authorization capability.
7. Recovery readiness is still an independent gate. Restoring source data or an OpenFGA model does not prove that old grants remain valid. Rotate/revalidate the recovery epoch and replay independent revocations before releasing readiness, following the canonical recovery protocol. This spike does not implement the complete recovery control plane.

The fixture retains the historical **30-second dependency-recovery budget**: after a lost connection or endpoint outage, a fresh eligible request must succeed through the restored real dependencies within that bound. This is separate from independent security revalidation after a database restore and does not measure full application recovery. Recovery timings are retained with the final fault evidence.

## Bounded work and storage

The Phase 0 compiler supports the existing project/workspace, organization, direct-user, team-userset and conditional-viewer model. It follows at most three object levels, accepts at most 20 candidates per batch and sends at most 100 contextual tuples per candidate. Source queries have a bounded result limit and retain the existing five-second SQL timeout. Unsupported, conflicting or oversized contexts fail closed; no permissions are silently truncated to fit. Contextual-tuple limits are an explicit capability constraint, not support for arbitrary future custom-role graphs.

The SQL compiler filters relationships to the actor or teams containing that actor, retains organization/parent links, and loads only reachable policy dependencies. It verifies local membership using PostgreSQL time. A missing necessary grant path proves a negative result locally. Policy equivalence is tested against the real persisted OpenFGA model, including owner/admin, sparse viewer, direct and team grants, parent inheritance, expired and future conditional grants, absent objects and both read/manage permissions.

No remote permission tuples, generation snapshots, tombstones or graph-cleanup backlog are generated by normal contextual requests. This does not eliminate ordinary database retention responsibilities: source rows, diagnostic/audit history, WAL and dead-row reclamation still need production policies. OpenFGA retains its store and model metadata. The reference run measures actual storage instead of assuming it is bounded because tuple-write counters are zero.

The shared benchmark still scans at most 100 sparse candidates in batches of 20, returns the last-scanned cursor and preserves the 250 ms list budget. It reports source-side negative filters separately from remote checks. Those list candidates are not failed eligible commands or hidden first-attempt retries.

## Validation and reference measurement

The authorization preflight passed **33 tests across three files**: the preserved 21 generation/retention cases plus twelve contextual integration cases. The new suite includes 60 comparisons against the real stored-model evaluator; immediate revocation and create-read; zero persisted contextual tuples; a late persistent write into an old request namespace; an allowed response arriving after loss of its lock-bearing connection; endpoint outage and a real HTTP timeout; inactive/expired membership; recovery/model gates; bounded contexts; and transaction rollback. Five additional inter-transaction cases exercise revocation, condition expiry, membership deactivation, epoch change, and an unrelated revision change. Strict TypeScript checking passed.

The full reference command is:

```sh
OPENFGA_VERSION=1.21.0 \
AUTHZ_DOCKER_LIMITS=14cpu-16745295872bytes-tmpfs8589934592bytes \
AUTHZ_STORAGE_BUDGET_BYTES=6442450944 \
AUTHZ_REPORT=artifacts/phase0/authz-contextual-full-2026-09-23.json \
caffeinate -i node --import tsx spikes/phase0/authz/benchmark.ts --contextual
```

`bun run phase0:authz:benchmark` and `phase0:authz:contextual` invoke the same entry point and flag. On macOS, the process-scoped `caffeinate -i` wrapper prevents idle sleep during measurement; it does not prevent lid-closure sleep. `--smoke` is diagnostic and cannot qualify. `phase0:authz:legacy` and the unflagged raw benchmark remain reproducible for the rejected full-copy candidate.

The dataset, 50 clients, 60-second warm-up, 1,800-second measurement, hot-tenant distribution, traffic mix, retry policy, 8 GiB tmpfs, 6 GiB storage guard and million-tuple guard are unchanged. SQL round trips are combined and source indexes are analyzed after seeding; these implementation changes are recorded with the new source hashes.

For this synchronous design, the report's projection/readiness metric measures authorization-change submission through actual COMMIT acknowledgement, including lock wait and authorization. It conservatively covers when the changed source becomes usable; it is not a fictitious zero-duration graph build. The same two-second target applies. Separate create-to-readable measurements still require an actual authorized read. Persistent graph build/cleanup metrics have no samples because those jobs do not exist in this candidate; graph write amplification remains explicitly reported.

## Completed reference result

The [raw report](../../spikes/phase0/authz/evidence/contextual-full-2026-09-23.json) and [runner log](../../spikes/phase0/authz/evidence/contextual-full-2026-09-23.log) record **PASS / HEALTHY_GATE_PASSED**, exit code 0. Measurement began at **09:53:04.382 UTC on September 23** and ran **1,821.564 seconds** after a 60-second warm-up. All original numeric thresholds, the full dataset and 50-client workload were retained.

| Metric | Completed result | Requirement |
| --- | --- | --- |
| Submitted requests | 1,658,137; about 910/second | Full reference workload for at least 1,800 seconds |
| First-attempt success | **99.950185%** | At least 99.9% |
| Eventual success | **99.995417%** | Report separately; cannot conceal first-attempt failures |
| Read / write p95 | **69.16 / 116.37 ms** | Below 500 / 800 ms |
| Fence-wait p95 / p99 / max | **61.60 / 71.42 / 1,203.62 ms** | p95 below 100 ms; retain tail failures |
| Authorization readiness p95 | **122.65 ms**, submission through source COMMIT | Below 2,000 ms |
| Create-to-readable p95 / max | **177.65 / 1,403.29 ms**; 81,680 samples, **zero deadline misses** | Below 2,000 ms |
| Revocation commit p95 | **122.51 ms** | Authoritative revocation at commit |
| Storage at final sample | **689,607,099 bytes (657.7 MiB)** including WAL | Below unchanged 6 GiB guard |
| Persistent graph writes / amplification | **0 / 0** | Report all writes, including final drain |
| Attempts / retained snapshots / pending revisions | **0 / 0 / 0** | No unbounded publication backlog |

There were **750 first-attempt lock timeouts and 76 client request timeouts**, with zero deliberate denials. Retries recovered 750 requests; **76 requests ultimately failed**. These failures remain in the denominator and raw report. This meets the specified aggregate threshold; it does not claim zero errors. Post-run SQL independently found **zero OpenFGA tuples and changelog rows**; its database occupied about 7.8 MiB. The application still retains ordinary source rows and its diagnostic commit journal, which need production retention policies.

The [validation record](../../spikes/phase0/authz/evidence/contextual-validation-2026-09-23.json) includes commands, source hashes, runtime limits and storage diagnostics. **33 tests** and strict TypeScript checking passed. [Fault recovery timings](../../spikes/phase0/authz/evidence/contextual-fault-timings-2026-09-23.json) were 5.68 ms after connection loss, 6.24 ms after an HTTP timeout, and 5.00 ms after endpoint outage, against the existing 30-second fixture budget.

Two earlier diagnostic attempts remain visible: the [exclusive-fence version](../../spikes/phase0/authz/evidence/contextual-fence-diagnostic-2026-09-23.json) was stopped after fence p95 exceeded 100 ms, prompting the preflight/revalidation change; the [sleep-interrupted run](../../spikes/phase0/authz/evidence/contextual-sleep-interrupted-2026-09-23.json) was rejected after a 302-second clamshell sleep, confirmed by the [host power log](../../spikes/phase0/authz/evidence/contextual-sleep-interrupted-host-2026-09-23.json). Neither is relabeled as a successful run.

The authorization blocker is resolved for this bounded synthetic policy. **Phase 0 is complete for the template scope.** Application scaffolding, service accounts, arbitrary new policy graphs, the real feature slice and image verification remain later acceptance work.
