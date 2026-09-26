# Phase 3 acceptance record

Phase 3's Foundation exit gate passed on 2026-09-26 against base commit `d9038e8beb56d28cb30b7039586ccc14dc03e8a7` plus the working-tree implementation. The final image and sustained benchmark share implementation fingerprint `7544a6e608a7af9570755a5d77397559df05655047d41d00f8fa57d1444ba974`; the fingerprint was unchanged throughout the benchmark. Documentation/evidence are excluded from this fingerprint to avoid self-reference.

| Requirement | Implementation and evidence | Current result |
| --- | --- | --- |
| `R-WORKSPACES` | Resource suite: inherited access, moves, archived assignments, module disable, tenant-composite parents; real RPC/REST cases | Passed in the full integration suite |
| `R-KEYS` | Current key/account/epoch/scope boundary, provisioning/rotation/revocation, create-only replay protection; real transport and key suites | Passed |
| `R-POLICY` | Transactional generic reservations, missing/disabled/zero/unlimited policies, final-slot create/restore races, scoped retry receipts | Passed in the full integration suite |
| `R-AUTHZ` | Production contextual Project/workspace graph, human/team/service policy, fences, expiry, namespace isolation and failure suite; 48 stored/contextual parity decisions across 16 principals | Passed |
| `R-AUTHZ-PERF` | Full-data API smoke and required 30-minute API benchmark | Passed: 464,211/464,211 operations, zero retries, all latency targets met |
| API/concurrency | One oRPC contract/router/service for RPC and public REST, explicit DTOs, origin checks, invalid input, tenant policy and stale writes | Six real-service transport tests passed |
| Migrations/role isolation | Fresh and Phase 2 upgrade fixtures; forced RLS, nonprivileged runtime roles and tenant foreign keys | Five migration tests passing |
| UI/required stack | Localized Project form/dashboard, shared RHF/Zod patterns and stories, browser journeys, clean production build | Production build, Storybook and all 10 browser journeys passed |

Executed checks: frozen install, Biome, strict types, Knip, 78 unit tests, 113 integration tests, the real OpenFGA model assertions (28 policy cases and four additional contextual checks), production build, 10 Chromium journeys, Storybook, container runtime acceptance and both dependency/image vulnerability gates. Local reports are retained in `artifacts/phase3/`, `artifacts/authz/` and `artifacts/security/`. No dependency or image HIGH/CRITICAL finding required an exception. No commit or PR was created, so commit-range/PR-title validation was not applicable.

## Sustained performance acceptance

Run `authorization-benchmark-2026-09-26T17-31-52-386Z.json` completed at **18:02:59 UTC on 2026-09-26**. After a 60-second warm-up it sustained **1,800.627 measured seconds**, with all 50 clients active and no retries. All **464,211 eligible operations succeeded** (100% first-attempt and eventual success), at **257.81 operations/second**. The 14,451 deliberate post-revocation denials are separate from eligible failures.

| Measurement | p95 ms | p99 ms | Maximum ms | Required p95 |
| --- | ---: | ---: | ---: | --- |
| Read/list operation | 263 | 331 | 699 | <500 ms |
| Write operation | 575 | 651 | 1,020 | <800 ms |
| Create to first authorized read | 644 | 711 | 997 | <2,000 ms |
| Authorization source commit | 444 | 524 | 903 | <2,000 ms |
| Authorization fence wait | 56 | 71 | 416 | <100 ms |
| Revocation through subsequent denied read | 651 | 720 | 1,020 | Reported |
| Revocation writer fence wait | 67 | 80 | 405 | Reported |

The dataset started with 100 tenants, 1,000 memberships, 100,000 Projects and 200 workspace parents. The hot tenant owned 50,000 Projects and received **80.004%** of traffic. The measured 60/20/10/10 mix comprised 278,530 reads/lists, 92,866 ordinary updates, 46,414 creates/deletes and 46,401 sharing/revocation/move operations. The 1%-access principal traversed 37,259 sparse pages returning 14,683 authorized rows. Cold cursors started fresh queries after five idle minutes (6,004 planned resets); this introduced no retry or invalid-input failure.

Twenty-five clients called RPC and twenty-five called REST through the actual in-process handlers and normal runtime, including real signed Better Auth sessions, Zod validation, DTO serialization, restricted database roles and pool queueing. Application, identity and control pools each had eight connections. The measurement excludes TCP/Next route-wrapper overhead; the browser suite separately exercises the real Next HTTP routes. Create and revoke workflow timings include their subsequent read. This is the Phase 3 real-feature gate; sustained performance against the built image remains the explicitly later hardening gate.

Hardware was an arm64 Apple M4 Pro (14 CPUs, 48 GiB RAM), with Node 24.19.0 and Bun 1.4.2. Disposable services used the digest-pinned PostgreSQL 18.6 and OpenFGA 1.21.0 images from `infra/compose.yaml`. PostgreSQL had `fsync=on`, `synchronous_commit=on`, 128 MB shared buffers, 4 MB work memory and 100 maximum connections. Application/control data directories used the documented 1 GiB/256 MiB tmpfs mounts; these results are not a persistent-disk capacity claim. The raw report records exact images and container limits. A command-scoped sleep assertion kept the host awake; maximum observed event-loop lag was 15.11 ms against the 5,000 ms interruption threshold.

The run submitted **1,090,317 contextual checks**, with p95/p99/maximum context size seven tuples against the enforced limit of 100. It made **zero tuple-write requests**; independent reads verified zero stored permission tuples before and after the run. Projection attempts, abandoned generations and contextual graph cleanup work were all zero. Application storage grew by 202.875 MiB (including durable audit/outbox, receipts and soft-delete history); control database size did not grow. Application-cluster WAL increased by 875.159 MiB, and control-cluster WAL by 320 bytes, including warm-up. WAL positions are cluster-wide; the full report preserves per-relation sizes and measurement scope.

The matching non-root image is `sha256:0a8481229296bf460bdd46d5b08a6ddb0cdcbb2303102b6d3750b2c338d41b9f`. Its runtime acceptance passed on Node 24.21.0, including restricted child credentials, migration/readiness behavior, native dependencies, health and graceful failure/shutdown. The packaged `authz-upgrade` command is present; the real predecessor upgrade and interrupted publication/recovery-state cases are exercised by integration tests. See `artifacts/phase3/image-acceptance.json`, `image-policy.json`, `unit.xml`, `integration.xml`, and the build/browser/Storybook logs.

## Retained diagnostics

The actual API smoke used 25 RPC and 25 REST clients, 8-connection application/identity/control pools, real signed sessions and the full dataset. All 3,460 eligible operations succeeded without retry; p95 reads were 260 ms, writes 433 ms, create-to-readable 475 ms and fence waits 51 ms. This short result is diagnostic evidence, not the 30-minute gate.

The initial baseline had 60 passing unit tests and 72 of 74 passing integration tests. Two pre-existing identity MFA/passkey tests failed, then both suites passed on an unchanged rerun (31 tests). The initial report is retained at `artifacts/phase3/baseline-integration.xml`.

The first full-data performance smoke had 378/378 successful operations but failed latency and fence-wait budgets. Batching source reads improved a later smoke to 1,893/1,893 successful operations at about 123 operations/second, but that run still failed the read/write/fence latency thresholds. Profiling then exposed an index/order null-placement mismatch that caused a full hot-tenant list sort; the query now matches the index. These early diagnostics called services directly with 60-connection pools. Final evidence uses the normal API runtime's 8-connection pools, includes pool queueing in latency, and retains all 50 concurrent clients and the prescribed dataset/traffic distribution. Failed measurements remain diagnostic evidence, not acceptance. No Phase 0 benchmark result is substituted for the production feature gate.

The first sustained attempt was interrupted after the macOS host entered idle sleep for 237 seconds. The run retained 273,468 operations, including 43 availability errors and seven failed revocation probes around the pause. It also exposed 212 invalid-input errors from the harness reusing cold-tenant cursors after their 15-minute expiry. This run is not acceptance evidence (`authorization-benchmark-2026-09-26T16-52-25-719Z.json` and `host-sleep.log`). The harness now starts a fresh query for a cursor idle for five minutes, rejects long event-loop stalls, and runs under a command-scoped sleep assertion. No failed command is retried and no acceptance target is relaxed.
