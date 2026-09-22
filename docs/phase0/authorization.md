# ADR P0-AUTHZ: generation isolation is correct in the spike; full-copy publication is rejected

Date: 2026-09-22. Owners: authorization/platform engineering; production protocol approval remains open.

**Decision: reject the full-organization-copy candidate for production. Phase 0's authorization availability exit gate has not passed.** Keep the fail-closed revocation contract. The implementation below is executable decision evidence, not the production authorization module.

The candidate prevents the tested obsolete-grant failures, but even a small healthy run rejects most otherwise eligible requests while projection is pending. The reference-size attempt also exhausted the local PostgreSQL tmpfs before completing its required 30-minute measurement. A larger disk alone does not resolve the readiness failures already reproduced without dependency failures at smaller scale.

## Implementation and boundaries

Source: [`spikes/phase0/authz`](../../spikes/phase0/authz/).

- PostgreSQL stores authoritative tuples, resource identities, current membership eligibility, revisions, an atomic change outbox, and durable projection attempts. User lifecycle advisory fences precede organization authorization fences. Protected reads/updates retain a shared fence through the OpenFGA check and SQL operation; authorization changes take the exclusive fence from the start.
- Every attempt receives a fresh UUID namespace and a fixed, independently copied source snapshot. Organization references, parent edges, team usersets and target objects all carry tenant, recovery epoch and generation. Stable user IDs remain subject to current local membership checks.
- The model includes explicit manager/viewer grants, active organization membership, administrators, team usersets, workspace inheritance, and server-time expiry conditions. All checks pin the model and request `HIGHER_CONSISTENCY`.
- A replacement attempt durably abandons earlier building/verified attempts under the organization fence. Remote requests have bounded deadlines and no hidden write retries. A timed-out request may complete, but its namespace stays unreachable. Publication rereads persisted attempt metadata, acknowledgement state, lease, model, epoch and source revision; it does not trust mutable caller metadata.
- Publication retires the previous generation only after fenced readers drain. Cleanup targets retired/abandoned namespaces belonging to the current run's store. Repeated sweeps tolerate a late request recreating unreachable tuples. Attempt identities are retained; namespaces are never reused.

The schema and role are deliberately synthetic. These files do not provide production RLS/migrations, complete identity eligibility, HTTP API validation, an independently durable recovery control plane, or a production garbage-collection policy. Recovery tests cover generation/epoch/readiness fencing; they do **not** establish the full restore and independent revalidation protocol in [operations §4.8](../04-billing-usage-operations.md#recovery-readiness-protocol).

## Recorded evidence

The reproducible source report files are checked in under [`spikes/phase0/authz/evidence`](../../spikes/phase0/authz/evidence/). Fresh runner output goes to ignored `artifacts/phase0/`.

| Evidence | Result | Interpretation |
| --- | --- | --- |
| Ten deterministic protocol tests | Passed | Fixed snapshots, stale revisions, late writes, duplicate work, bounded/FIFO fences, expiry, cleanup and epoch/model checks; these are model evidence |
| Eight real PostgreSQL/OpenFGA tests | Passed | Lost-lock late write, timeout ambiguity, duplicate writes/work, endpoint outage and local deactivation, inheritance/expiry/membership, queued-writer fairness, recovery epoch, persisted model pinning |
| [Clean short workload](../../spikes/phase0/authz/evidence/final-smoke-2026-09-22.json) | Candidate rejected; workload `INCOMPLETE` | 10 tenants, 100 memberships, 1,000 resources, 50 clients and 10 measured seconds; insufficient duration/scale for gate approval |
| [Reference-size attempt](../../spikes/phase0/authz/evidence/full-2026-09-22.json) | Candidate rejected; workload `INCOMPLETE` | 100 tenants, 1,000 memberships, 100,000 resources and 50 clients; required 1,800-second run interrupted after PostgreSQL storage exhaustion |
| [Storage-limit behavior](../../spikes/phase0/authz/evidence/storage-cap-2026-09-22.json) | Correct early stop with retained failure report | Artificial 1-byte budget tests the harness's safety exit; this is not a capacity measurement |

The reference-size measurement began at **12:51:50 UTC**. At its 30-second checkpoint, 63 of 2,559 submitted requests had succeeded on the first attempt; 2,465 had already reported projection-pending failures. At 60 seconds, 85 of 5,217 had succeeded on the first attempt, with 5,108 projection-pending failures. These are live snapshots with requests still in flight, not final rate/percentile claims. PostgreSQL then rejected connections with SQLSTATE `53100`, “could not write init file: No space left on device”. Its `/var/lib/postgresql` tmpfs was 3.9 GiB used, zero free. The benchmark processes were stopped, diagnostics retained, and only the disposable fixture services reset.

The final short diagnostic run completed 9,075 submitted requests, with **8.53% first-attempt success** and **9.94% eventual success**, zero deliberate denials and zero projection/cleanup dependency errors. Its successful-read/write p95 values were 31.2/21.8 ms, fence-wait p95 was 25.9 ms, and projection p95 was 1,107.6 ms. Six creates exceeded the two-second readable deadline; reporting only the 66 successful create-read samples would conceal those failures. Measured graph write amplification was 237.1 tuples per committed authorization change, including the final drain. All of these numbers describe the short diagnostic fixture, not the reference capacity gate.

Hardware was an Apple M4 Pro, 14 logical host CPUs and 48 GiB host memory; Docker had 14 CPUs and 8,318,976,000 bytes of memory. Versions: Node 24.19.0, PostgreSQL 18.6 and OpenFGA 1.21.0. The tmpfs limit is a local deployment limitation, not evidence that every deployment exhausts storage at the same point. The short run's poor first-attempt availability without dependency failures independently falsifies the proposed healthy availability target. Successful-read latency does not compensate for those failures.

### Fault recovery budget

Set a **30-second projection recovery budget** after dependencies return for this Phase 0 fault fixture. Tests assert it separately for connection loss, ambiguous timeout, and endpoint outage; the [recorded timings](../../spikes/phase0/authz/evidence/fault-timings-2026-09-22.json) were approximately 62 ms, 25 ms and 18 ms respectively on the tiny fixture. These numbers do not predict recovery of a 50,000-resource hot tenant or establish the four-hour disaster-recovery RTO.

The late-write test sends an actual HTTP write to a deterministic delay proxy while attempt A owns a PostgreSQL transaction and the exclusive organization advisory fence. `pg_terminate_backend` destroys that lock-bearing connection. Attempt B supersedes A and publishes revision N; a new source transaction revokes the grant and publishes N+1. Only then does the proxy forward A's old request to real OpenFGA. The old namespace contains the grant, the current one denies it, and A cannot acknowledge or publish. This intentionally demonstrates why loss of a database lock cannot cancel an in-flight remote effect.

## Reproduction

Run the pinned workspace install and start the [disposable compose services](../../spikes/phase0/compose.yaml), then:

```sh
bun run phase0:services:up
PHASE0_INTEGRATION=1 node node_modules/vitest/vitest.mjs run spikes/phase0/authz
OPENFGA_VERSION=1.21.0 AUTHZ_DOCKER_LIMITS=14cpu-8318976000bytes bun run phase0:authz:smoke
```

The full command preserves the specified workload and does not silently lower the scale:

```sh
OPENFGA_VERSION=1.21.0 \
AUTHZ_DOCKER_LIMITS=14cpu-8318976000bytes \
AUTHZ_REPORT=artifacts/phase0/authz-full.json \
bun run phase0:authz:benchmark
```

Use the actual deployment values for `AUTHZ_DOCKER_LIMITS`; the label records operator-provided metadata, not an automatic verification. `AUTHZ_DATABASE_URL` and `OPENFGA_URL` can target another isolated synthetic fixture. The default development credentials are exclusively for this local fixture. Never target a customer store.

Defaults: 60-second warm-up, 1,800 measured seconds, 50 clients, one tenant with half the resources and 80% of requests, and a seeded 60/20/10/10 read/update/create-delete/sharing-revocation-parent mix. Ordinary creation includes an initial manager grant and advances the revision. One hot-tenant principal has explicit access to 1% of initial candidates. Sparse lists scan at most 100 candidates in batches of 20 and return a last-scanned cursor, including for partial pages.

The report records first attempts and eventual outcomes separately, intentional denials, achieved traffic mix, request rate, CRUD/fence/pool/create-read/revocation/build/cleanup percentiles, pending revisions, persisted attempt states, abandoned-build rate, graph writes and interval write amplification. Revocation latency runs from submission through authoritative commit; projection latency separately records when the replacement graph becomes readable. Creates poll for readiness for at most two seconds. Commands have at most two attempts with one 25 ms delay. FGA write retries are disabled. These policies are explicit workload inputs, not success-rate corrections.

Application/projector/cleanup pools are 60/4/2 connections, with at most three concurrent projection builds. Lock timeout is 1 second; statement timeout is 5 seconds; graph request timeout is 1 second; attempt lease is 120 seconds; pool queue guard is 100 waiters. A 30-second drain budget follows client shutdown. Full qualification requires the actual measured duration, default full scale and recorded service/deployment metadata; shorter or smoke runs remain `INCOMPLETE` even if individual thresholds pass.

The runner now writes an atomic checkpoint every ten seconds and during seeding, and writes a retained `INCOMPLETE`/`REJECT` report on interruption, fatal error or a resource limit. Its default diagnostic storage budget is 2 GiB across all fixture databases plus WAL, with a cap of one million retained generation tuples. `AUTHZ_STORAGE_BUDGET_BYTES` explicitly changes the storage budget for a documented deployment. These are sampled early-stop limits, not filesystem quotas: allocation can overshoot between samples. A production protocol still needs bounded durable retention and admission/backpressure. The unchanged rejected candidate should not be rerun merely with a larger limit.

## Required redesign before Phase 2

1. Select an alternative that preserves authoritative-commit revocation and isolates late writes: receiver-enforced fencing, a demonstrably safe incremental publication design, or an authoritative relational authorization design are candidates. A database mutex around mutable OpenFGA writes alone remains disallowed.
2. Specify atomic source-change admission, list/reader behavior, source-to-graph readiness, crash recovery, stable model/epoch binding, and finite retention of attempts/late-write cleanup. Explain how resource creation remains available under the full hot-tenant mix.
3. Update the canonical architecture contract, logical schema and future shared skill requirements together with the chosen ADR. Implement the alternative and rerun both the lost-lock/late-write suite and the complete healthy workload on storage with recorded capacity and service limits.
4. Record measured first-attempt availability and every prescribed latency/cleanup/recovery budget; only then approve the protocol. Re-run against the actual Project slice before Phase 4 and against release infrastructure during hardening.

The Phase 0 estimate and Phase 2 start condition must be revised to include this unresolved redesign plus another full correctness/performance cycle. No defensible fixed effort estimate follows from this single candidate failure; estimate after selecting and scoping the alternative. The original 3–5 engineer-week Phase 0 allowance and overall roadmap estimate remain provisional, not validated by this spike.

API/model references used in the implementation: [OpenFGA configuration language](https://openfga.dev/docs/configuration-language), [immutable models](https://openfga.dev/docs/getting-started/immutable-models), [conditions](https://openfga.dev/docs/modeling/conditions), and [consistency modes](https://openfga.dev/docs/interacting/consistency). Repository requirements remain [architecture §2.6](../02-architecture-and-security.md#26-relationship-based-authorization) and [operations §4.7](../04-billing-usage-operations.md#phase-0-authorization-decision-gate).
