# ADR P0-AUTHZ: generation isolation is correct in the spike; full-copy publication is rejected

Date: 2026-09-22; rerun update: 2026-09-23 (Europe/Madrid). Owners: authorization/platform engineering; production protocol approval remains open.

**Historical decision: reject the full-organization-copy candidate for production.** The replacement implementation and its separate gate evidence are recorded in [ADR P0-AUTHZ-2](contextual-authorization.md). Keep the fail-closed revocation contract. The implementation below is executable decision evidence, not the production authorization module.

The candidate prevents the tested obsolete-grant failures, but even a small healthy run rejects most otherwise eligible requests while projection is pending. The original reference-size attempt exhausted the local PostgreSQL tmpfs. A rerun with an explicit 8 GiB tmpfs stopped at the retained-generation tuple limit. The subsequent snapshot-retention fix eliminated terminal snapshot payloads and kept sampled retained tuples below that unchanged cap, but its reference run stopped at the 6 GiB database-plus-WAL storage guard after 51 measured seconds, with storage dominated by OpenFGA. None completed the required 30-minute measurement. Snapshot compaction is fixed; this historical full-copy design still fails readiness availability and remote storage capacity. Its replacement removes persistent permission graph publication.

## Implementation and boundaries

Source: [`spikes/phase0/authz`](../../spikes/phase0/authz/).

- PostgreSQL stores authoritative tuples, resource identities, current membership eligibility, revisions, an atomic change outbox, and durable projection attempts. User lifecycle advisory fences precede organization authorization fences. Protected reads/updates retain a shared fence through the OpenFGA check and SQL operation; authorization changes take the exclusive fence from the start.
- Every attempt receives a fresh UUID namespace and a fixed, independently copied source snapshot. Organization references, parent edges, team usersets and target objects all carry tenant, recovery epoch and generation. Stable user IDs remain subject to current local membership checks.
- The model includes explicit manager/viewer grants, active organization membership, administrators, team usersets, workspace inheritance, and server-time expiry conditions. All checks pin the model and request `HIGHER_CONSISTENCY`.
- A replacement attempt durably abandons earlier building/verified attempts under the organization fence. Remote requests have bounded deadlines and no hidden write retries. A timed-out request may complete, but its namespace stays unreachable. Publication rereads persisted attempt metadata, acknowledgement state, lease, model, epoch and source revision; it does not trust mutable caller metadata.
- Publication retires the previous generation only after fenced readers drain. Terminal transitions now clear snapshot payloads atomically, retaining compact namespace tombstones. Cleanup reads actual tuples from the current run's OpenFGA store in bounded pages and removes only exact matches to retired/abandoned namespaces. Repeated sweeps tolerate a late request recreating unreachable tuples. Attempt identities are retained; namespaces are never reused.

The schema and role are deliberately synthetic. These files do not provide production RLS/migrations, complete identity eligibility, HTTP API validation, an independently durable recovery control plane, or a production garbage-collection policy. Recovery tests cover generation/epoch/readiness fencing; they do **not** establish the full restore and independent revalidation protocol in [operations §4.8](../04-billing-usage-operations.md#recovery-readiness-protocol).

## Recorded evidence

The reproducible source report files are checked in under [`spikes/phase0/authz/evidence`](../../spikes/phase0/authz/evidence/). Fresh runner output goes to ignored `artifacts/phase0/`.

| Evidence | Result | Interpretation |
| --- | --- | --- |
| Ten deterministic protocol tests | Passed | Fixed snapshots, stale revisions, late writes, duplicate work, bounded/FIFO fences, expiry, cleanup and epoch/model checks; these are model evidence |
| Eight real PostgreSQL/OpenFGA tests | Passed | Lost-lock late write, timeout ambiguity, duplicate writes/work, endpoint outage and local deactivation, inheritance/expiry/membership, queued-writer fairness, recovery epoch, persisted model pinning |
| [Clean short workload](../../spikes/phase0/authz/evidence/final-smoke-2026-09-22.json) | Candidate rejected; workload `INCOMPLETE` | 10 tenants, 100 memberships, 1,000 resources, 50 clients and 10 measured seconds; insufficient duration/scale for gate approval |
| [Reference-size attempt](../../spikes/phase0/authz/evidence/full-2026-09-22.json) | Candidate rejected; workload `INCOMPLETE` | 100 tenants, 1,000 memberships, 100,000 resources and 50 clients; required 1,800-second run interrupted after PostgreSQL storage exhaustion |
| [Reference-size rerun, 8 GiB tmpfs](../../spikes/phase0/authz/evidence/full-rerun-2026-09-23.json) | Candidate rejected; workload `INCOMPLETE`; exit code 2 | Same reference workload and 60-second warm-up; retained snapshot tuples reached 1,197,732 against the unchanged 1,000,000 cap after about one measured second |
| [Rerun fault preflight](../../spikes/phase0/authz/evidence/fault-timings-2026-09-23.json) | 18 tests passed across two files | Ten model tests and eight real PostgreSQL/OpenFGA tests, run before resetting the disposable services for the benchmark |
| [Snapshot-retention fix validation](../../spikes/phase0/authz/evidence/retention-validation-2026-09-23.json) | 21 tests and typecheck passed | Ten model tests and eleven real-service tests, including late writes after compaction and resumable remote cleanup |
| [Reference run after snapshot fix](../../spikes/phase0/authz/evidence/retention-full-2026-09-23.json) | `INCOMPLETE` / `REJECT`; exit code 2 | 51.138 measured seconds; terminal snapshot tuples zero; sampled retained peak 306,197; separate 6 GiB storage guard exceeded |
| [Storage-limit behavior](../../spikes/phase0/authz/evidence/storage-cap-2026-09-22.json) | Correct early stop with retained failure report | Artificial 1-byte budget tests the harness's safety exit; this is not a capacity measurement |

The reference-size measurement began at **12:51:50 UTC**. At its 30-second checkpoint, 63 of 2,559 submitted requests had succeeded on the first attempt; 2,465 had already reported projection-pending failures. At 60 seconds, 85 of 5,217 had succeeded on the first attempt, with 5,108 projection-pending failures. These are live snapshots with requests still in flight, not final rate/percentile claims. PostgreSQL then rejected connections with SQLSTATE `53100`, “could not write init file: No space left on device”. Its `/var/lib/postgresql` tmpfs was 3.9 GiB used, zero free. The benchmark processes were stopped, diagnostics retained, and only the disposable fixture services reset.

The final short diagnostic run completed 9,075 submitted requests, with **8.53% first-attempt success** and **9.94% eventual success**, zero deliberate denials and zero projection/cleanup dependency errors. Its successful-read/write p95 values were 31.2/21.8 ms, fence-wait p95 was 25.9 ms, and projection p95 was 1,107.6 ms. Six creates exceeded the two-second readable deadline; reporting only the 66 successful create-read samples would conceal those failures. Measured graph write amplification was 237.1 tuples per committed authorization change, including the final drain. All of these numbers describe the short diagnostic fixture, not the reference capacity gate.

Hardware was an Apple M4 Pro, 14 logical host CPUs and 48 GiB host memory; Docker had 14 CPUs and 8,318,976,000 bytes of memory. Versions: Node 24.19.0, PostgreSQL 18.6 and OpenFGA 1.21.0. The tmpfs limit is a local fixture limitation, not evidence that every environment exhausts storage at the same point. The short run's poor first-attempt availability without dependency failures independently falsifies the proposed healthy availability target. Successful-read latency does not compensate for those failures.

### Rerun with increased memory and tmpfs capacity

The rerun is dated **2026-09-23 in Europe/Madrid**; its UTC measurement start was **2026-09-22 22:11:44.812 UTC**. The [environment and source hashes](../../spikes/phase0/authz/evidence/rerun-environment-2026-09-23.json) and [runner log](../../spikes/phase0/authz/evidence/full-rerun-2026-09-23.log) accompany the unmodified stop report. Docker had 14 CPUs and **16,745,295,872 bytes of memory**; the verified PostgreSQL tmpfs capacity was **8,589,934,592 bytes (8 GiB)**. Service/runtime versions were unchanged. The user-provided Compose size change was preserved. The harness was also unchanged from its checked-in checkpoint/resource-guard version, which postdates the original September 22 attempt.

The run used the full reference dataset, 50 clients, default traffic distribution/mix, 60-second warm-up and requested 1,800-second measurement. Its explicit database-plus-WAL storage budget was **6,442,450,944 bytes (6 GiB)**, leaving headroom within the 8 GiB filesystem. The independent **1,000,000 retained-tuple cap** was unchanged. Only the disposable services were reset before seeding, and no competing test suites ran during measurement.

The runner exited with code 2 after reporting **1.001 measured seconds**, because retained generation snapshots contained **1,197,732 tuple entries**. At that storage sample, database files plus WAL totaled **4,335,451,403 bytes**, below the 6 GiB storage guard. After process exit, the filesystem had **4,473,757,696 bytes used and 4,116,176,896 bytes free**. This attempt did not reproduce the previous filesystem-exhaustion failure; it hit the harness's retention guard first.

The stop checkpoint recorded **177 submitted requests, 7 first-attempt successes, 7 eventual successes and 170 projection-pending first-attempt failures**, with zero recorded projection or cleanup dependency errors. These are early-stop diagnostics, not a completed rate/percentile result. The report is written before all background work settles; it cannot establish sustained availability, final projection latency, create-to-readable performance, or write amplification including a normal final drain. Its status remains `INCOMPLETE` / `REJECT`.

The retained-tuple counter sums the tuple arrays stored in PostgreSQL's attempt records, including retired attempts; it does **not** count only live OpenFGA relationships. After shutdown, 575 retired snapshots held 995,531 entries and 100 active snapshots held 203,246. At the time of that rerun, cleanup deleted remote tuples but kept the snapshot payloads for repeated late-write sweeps. Those retained payloads explain why successful remote cleanup did not reduce this counter. The subsequent [snapshot retention fix](#snapshot-retention-fix) replaces that behavior without increasing the guard.

**Conclusion from the capacity-only rerun:** the larger tmpfs removed the immediate storage ceiling encountered previously, but this rerun did not complete the reference gate or overturn the clean short-run availability failure. This run left the full-copy candidate rejected and Phase 0 unapproved at that point. This evidence supports work on bounded retention and readiness availability; it does not establish how long an uncapped run would last or whether another test environment would exhaust storage.

### Snapshot retention fix

The September 23 fix addresses the retained full-snapshot payloads, without increasing the one-million-tuple guard or relaxing revocation:

- A PostgreSQL trigger clears `tuples` to `[]` in the same transaction that retires or abandons an attempt. Its ID, generation, organization, epoch, model and manifest remain as a small tombstone. Terminal states cannot be reactivated, and the unique generation/attempt constraints still prevent reuse. Existing terminal snapshots are compacted when installing the fixture schema.
- Cleanup also abandons expired building/verified attempts. Publication and acknowledgement still require the live persisted state and lease, so an expired worker cannot publish after its snapshot is discarded.
- OpenFGA's Read API supplies at most 100 stored tuples per cleanup call with `HIGHER_CONSISTENCY`. Cleanup deletes only tuples whose exact organization, epoch and generation match a persisted terminal attempt within the literal organization prefix. Active, building, verified, unknown and other-scope namespaces are preserved.
- A PostgreSQL cursor is scoped to the graph endpoint, store and organization prefix. One collector owns that cursor per transaction, and advances it only after all deletes on the page succeed. A crash or lost delete response leaves the page retryable; deletes are idempotent. An empty continuation token restarts the next sweep, discovering writes that arrive after earlier cleanup or are missed by concurrent pagination changes. Restarting a worker preserves cursor progress.

This removes the need to keep every old graph snapshot for future cleanup. It does not assume that a remote request is cancelled by a database lock loss, lease expiry or timeout. Namespace isolation continues to protect access while late remote tuples await a later sweep. Small tombstones and outbox history remain retained, and remote cleanup throughput and OpenFGA change-history retention still need capacity evidence; this change is not a claim that every form of storage is now bounded.

Validation: **21 authorization tests passed** (10 model tests, 11 real PostgreSQL/OpenFGA tests), and strict TypeScript checking passed. The real-service tests cover payload compaction across 20 retirements, namespace reuse/reactivation rejection, expired builders versus live building/verified attempts, bounded pagination, restart after a remotely successful delete with a lost response, literal scope isolation, and a held old HTTP write released only after its snapshot was removed and an initial sweep finished. A later sweep deletes that late write while the current owner's access remains valid and the revoked user's access stays denied.

The [post-fix reference run](../../spikes/phase0/authz/evidence/retention-full-2026-09-23.json) used the same 8 GiB tmpfs, Docker memory, 6 GiB storage guard, one-million-tuple guard, full dataset, warm-up and requested duration as the capacity-only rerun. The [validation record](../../spikes/phase0/authz/evidence/retention-validation-2026-09-23.json) retains the exact command, source hashes, final storage diagnostics and [fault timings](../../spikes/phase0/authz/evidence/retention-fault-timings-2026-09-23.json); the [runner log](../../spikes/phase0/authz/evidence/retention-full-2026-09-23.log) records measurement starting at **22:26:18.934 UTC on September 22** (September 23 locally).

It stopped at **51.138 measured seconds** when database files plus WAL reached **6,523,728,315 bytes**, exceeding the unchanged 6 GiB guard. The snapshot guard was not hit: the sampled peak was **306,197 tuple entries**, and terminal snapshots held **zero**. After background work settled, **1,103 retired attempts held zero snapshot tuples** and 100 active attempts held 203,584 entries. This confirms the specific snapshot-payload retention fix under the reference workload, without claiming a completed capacity gate.

The remaining storage growth was principally in OpenFGA: its tuple table including indexes occupied **4,442,038,272 bytes**, and its changelog including indexes occupied **1,132,617,728 bytes**. The authoritative fixture database occupied 119,912,127 bytes. The scanner had not completed a whole-store sweep before shutdown; this full-copy workload produces remote data faster than the current scan handles it. Bounded pages and crash-safe cursors do not by themselves establish a bounded remote backlog. The filesystem still had 1,781,268,480 bytes free after exit.

The stop checkpoint recorded 40,139 submitted requests, 2,341 first-attempt successes, 2,378 eventual successes, 37,798 projection-pending first-attempt failures, 21 create-read deadline misses, and no recorded projection/cleanup dependency errors. These remain early-stop counts, not final rates or full-duration percentiles. **At that point Phase 0 remained unapproved:** the full-snapshot retention defect is fixed, while readiness availability, remote cleanup throughput/change-history retention, and the complete reference gate remain unresolved.

### Fault recovery budget

Set a **30-second projection recovery budget** after dependencies return for this Phase 0 fault fixture. Tests assert it separately for connection loss, ambiguous timeout, and endpoint outage; the [recorded timings](../../spikes/phase0/authz/evidence/fault-timings-2026-09-22.json) were approximately 62 ms, 25 ms and 18 ms respectively on the tiny fixture. These numbers do not predict recovery of a 50,000-resource hot tenant or establish full application recovery time.

The late-write test sends an actual HTTP write to a deterministic delay proxy while attempt A owns a PostgreSQL transaction and the exclusive organization advisory fence. `pg_terminate_backend` destroys that lock-bearing connection. Attempt B supersedes A and publishes revision N; a new source transaction revokes the grant and publishes N+1. Only then does the proxy forward A's old request to real OpenFGA. The old namespace contains the grant, the current one denies it, and A cannot acknowledge or publish. This intentionally demonstrates why loss of a database lock cannot cancel an in-flight remote effect.

## Reproduction

Run the pinned workspace install and start the [disposable compose services](../../spikes/phase0/compose.yaml), then:

```sh
bun run phase0:services:up
PHASE0_INTEGRATION=1 node node_modules/vitest/vitest.mjs run spikes/phase0/authz
OPENFGA_VERSION=1.21.0 AUTHZ_DOCKER_LIMITS='<actual CPU/memory/storage limits>' bun run phase0:authz:legacy --smoke
```

The recorded September 23 rerun command preserves the specified workload and does not silently lower the scale (Node executes the same legacy entry point as `bun run phase0:authz:legacy`):

```sh
OPENFGA_VERSION=1.21.0 \
AUTHZ_DOCKER_LIMITS=14cpu-16745295872bytes-tmpfs8589934592bytes \
AUTHZ_STORAGE_BUDGET_BYTES=6442450944 \
AUTHZ_REPORT=artifacts/phase0/authz-full-rerun-2026-09-23.json \
node --import tsx spikes/phase0/authz/benchmark.ts
```

Use the actual fixture values for `AUTHZ_DOCKER_LIMITS`; the label records operator-provided metadata, not an automatic verification. `AUTHZ_DATABASE_URL` and `OPENFGA_URL` can target another isolated synthetic fixture. The default development credentials are exclusively for this local fixture. Never target a customer store.

Defaults: 60-second warm-up, 1,800 measured seconds, 50 clients, one tenant with half the resources and 80% of requests, and a seeded 60/20/10/10 read/update/create-delete/sharing-revocation-parent mix. Ordinary creation includes an initial manager grant and advances the revision. One hot-tenant principal has explicit access to 1% of initial candidates. Sparse lists scan at most 100 candidates in batches of 20 and return a last-scanned cursor, including for partial pages.

The report records first attempts and eventual outcomes separately, intentional denials, achieved traffic mix, request rate, CRUD/fence/pool/create-read/revocation/build/cleanup percentiles, pending revisions, persisted attempt states, abandoned-build rate, graph writes and interval write amplification. Revocation latency runs from submission through authoritative commit; projection latency separately records when the replacement graph becomes readable. Creates poll for readiness for at most two seconds. Commands have at most two attempts with one 25 ms delay. FGA write retries are disabled. These policies are explicit workload inputs, not success-rate corrections.

Application/projector/cleanup pools are 60/4/2 connections, with at most three concurrent projection builds. Lock timeout is 1 second; statement timeout is 5 seconds; graph request timeout is 1 second; attempt lease is 120 seconds; pool queue guard is 100 waiters. A 30-second drain budget follows client shutdown. Full qualification requires the actual measured duration, default full scale and recorded service/fixture metadata; shorter or smoke runs remain `INCOMPLETE` even if individual thresholds pass.

The runner writes an atomic checkpoint every ten seconds and during seeding, and writes a retained `INCOMPLETE`/`REJECT` report on interruption, fatal error or a resource limit. Its default diagnostic storage budget is 2 GiB across all fixture databases plus WAL, with a cap of one million retained generation tuples. `AUTHZ_STORAGE_BUDGET_BYTES` explicitly changes the storage budget for a documented fixture; the recorded rerun used 6 GiB. These are sampled early-stop limits, not filesystem quotas: allocation can overshoot between samples. A production protocol still needs bounded durable retention and admission/backpressure. The requested larger-capacity rerun is now recorded; another limit increase alone would not resolve the outstanding design failures.

## Redesign requirements and successor

The successor [ADR P0-AUTHZ-2](contextual-authorization.md) implements the alternative and records its own validation against these requirements. The historical reports above retain their original failed/incomplete status.

1. Select an alternative that preserves authoritative-commit revocation and isolates late writes: receiver-enforced fencing, a demonstrably safe incremental publication design, or an authoritative relational authorization design are candidates. A database mutex around mutable OpenFGA writes alone remains disallowed.
2. Specify atomic source-change admission, list/reader behavior, source-to-graph readiness, crash recovery, stable model/epoch binding, and finite retention of attempts/late-write cleanup. Explain how resource creation remains available under the full hot-tenant mix.
3. Update the canonical architecture contract, logical schema and future shared skill requirements together with the chosen ADR. Implement the alternative and rerun both the lost-lock/late-write suite and the complete healthy workload on storage with recorded capacity and service limits.
4. Record measured first-attempt availability and every prescribed latency/cleanup/recovery budget; only then approve the protocol. Re-run against the actual Project slice before Phase 4 and against release infrastructure during hardening.

The successor ADR now records a selected alternative and passing correctness/performance evidence. Phase 2 still needs a scoped production-integration estimate; the original full-copy failure did not establish one. The original 3–5 engineer-week Phase 0 allowance and overall roadmap estimate remain provisional, not validated by this spike.

API/model references used in the implementation: [OpenFGA configuration language](https://openfga.dev/docs/configuration-language), [immutable models](https://openfga.dev/docs/getting-started/immutable-models), [conditions](https://openfga.dev/docs/modeling/conditions), and [consistency modes](https://openfga.dev/docs/interacting/consistency). Repository requirements remain [architecture §2.6](../02-architecture-and-security.md#26-relationship-based-authorization) and [operations §4.7](../04-billing-usage-operations.md#phase-0-authorization-decision-gate).
