# Phase 3 acceptance record

> Historical record: Workspace behavior and related verification below describe the predecessor. The [removal brief](../../feature-briefs/remove-workspaces.md) supersedes that product design; these results do not verify the successor.

**Status: Phase 3's Foundation exit gate is pending a corrected full performance run.** The 2026-09-26 benchmark met its numeric thresholds but did not sustain actual parent changes: its operation counter always selected workspace 0, so repeated moves kept the existing parent. The report's recorded `passed` status is retained as historical output, not valid `R-AUTHZ-PERF` sign-off.

The historical image and benchmark ran against base commit `d9038e8beb56d28cb30b7039586ccc14dc03e8a7` plus the then-current working tree, sharing fingerprint `7544a6e608a7af9570755a5d77397559df05655047d41d00f8fa57d1444ba974`. That fingerprint was unchanged during that run, but does not cover the subsequent correctness and harness fixes. Documentation/evidence are excluded from fingerprints to avoid self-reference.

| Requirement | Implementation and evidence | Current result |
| --- | --- | --- |
| `R-WORKSPACES` | Resource suite: inherited access, moves, archived assignments, module disable, tenant-composite parents; real RPC/REST cases | Passed in the full integration suite |
| `R-KEYS` | Current key/account/epoch/scope boundary, provisioning/rotation/revocation, create-only replay protection; real transport and key suites | Passed |
| `R-POLICY` | Transactional generic reservations, missing/disabled/zero/unlimited policies, final-slot create/restore races, scoped retry receipts | Passed in the full integration suite |
| `R-AUTHZ` | Production contextual Project/workspace graph, human/team/service policy, fences, expiry, namespace isolation and failure suite; 48 stored/contextual parity decisions across 16 principals | Passed |
| `R-AUTHZ-PERF` | Corrected parent-change workload; historical smoke and 30-minute API reports retained | Pending corrected full run; historical 464,211/464,211 result lacks sustained parent changes |
| API/concurrency | One oRPC contract/router/service for RPC and public REST, explicit DTOs, origin checks, invalid input, tenant policy and stale writes | Eight real-service transport tests passed in the correctness rerun |
| Migrations/role isolation | Fresh and Phase 2 upgrade fixtures; forced RLS, nonprivileged runtime roles and tenant foreign keys | Five migration tests passing |
| UI/required stack | Localized Project form/dashboard, shared RHF/Zod patterns and stories, browser journeys, production build | Current build and 11 browser journeys passed; historical Storybook build passed |

Historical executed checks: frozen install, Biome, strict types, Knip, 78 unit tests, 113 integration tests, the real OpenFGA model assertions (28 policy cases and four additional contextual checks), production build, 10 Chromium journeys, Storybook, container runtime acceptance and both dependency/image vulnerability gates. Local reports are retained in `artifacts/phase3/`, `artifacts/authz/` and `artifacts/security/`. No dependency or image HIGH/CRITICAL finding required an exception. These reports describe their recorded implementation, not later changes. No commit or PR was created by that acceptance run, so commit-range/PR-title validation was not applicable.

## Correctness and benchmark corrections

The later audit (`artifacts/phase3/verification.md`) found three correctness gaps in addition to the benchmark defect. Key management now retains session, membership and fresh-authentication deadlines through commit; human resource authorization retains authoritative session expiry; service-account status changes require an expected version and return a conflict on stale edits. The fix record (`artifacts/phase3/fix-verification.md`) records 80 passing unit tests, 126 passing real-service integration tests, source/type/unused-code checks and a passing production build. Those fixes did not include browser, image or performance reruns.

The corrected benchmark tracks the confirmed parent separately for each Project, including warm-up state, and alternates between the two tenant workspaces. Every successful response must identify the requested Project and destination. Reports distinguish initial assignments from moves between workspaces and count both destinations. The gate requires these counts to reconcile with successful move operations and rejects any invalid move, including during warm-up; initial assignments alone cannot satisfy it. Deterministic tests cover the original 50-client operation schedule, tenant/project isolation, warm-up, failed operations and malformed/no-op responses without invoking the benchmark.

Verification after the harness correction on 2026-09-26 passed Biome, strict types, Knip, `git diff --check`, **87 unit tests** (including seven new workload regressions), **11 Chromium journeys**, production build, **14 image runtime checks** and the rebuilt image's vulnerability policy with zero HIGH/CRITICAL findings. The local web build reused its valid Turbo cache; the image rebuilt the application from the frozen install. The prior 126-test integration run is retained; integration, Storybook and dependency scans were not rerun for this harness-only change.

The verified current fingerprint is `f25459dea3abc11ed961b7bdc1fb6af4049e97525dee6cd35f9c872898ea78d3`, on base commit `983869c90d15d83ba6f01e7f4fa2bc117e44f86a` plus working-tree changes. The matching Linux arm64 image is `sha256:7f32670942c91ee25e57d3ae9d4052d15c0668a264175ebcb618d9ad4ee8d9e2`, with Node 24.21.0. Current reports are `artifacts/phase3/parent-move-unit.xml`, `parent-move-browser.json`, `parent-move-image-acceptance.json`, `parent-move-image-policy.json` and the corresponding build/browser/image logs. This refresh covers the earlier correctness fixes as well as the harness inputs; it does not supply new performance evidence.

The corrected full benchmark and smoke were deliberately not run. `R-AUTHZ-PERF` stays pending until the full command in the [run guide](README.md#run-the-full-performance-gate) passes on a stable implementation. Hosted CI and sustained performance against the built image are not claimed here; the latter remains the later hardening gate.

## Historical sustained performance result (not acceptance)

Run `authorization-benchmark-2026-09-26T17-31-52-386Z.json` completed at **18:02:59 UTC on 2026-09-26**. After a 60-second warm-up it sustained **1,800.627 measured seconds**, with all 50 clients active and no retries. All **464,211 eligible operations succeeded** (100% first-attempt and eventual success), at **257.81 operations/second**. The 14,451 deliberate post-revocation denials are separate from eligible failures. These measurements remain useful diagnostics, but the missing sustained parent changes prevent performance acceptance.

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

Twenty-five clients called RPC and twenty-five called REST through the actual in-process handlers and normal runtime, including real signed Better Auth sessions, Zod validation, DTO serialization, restricted database roles and pool queueing. Application, identity and control pools each had eight connections. The measurement excludes TCP/Next route-wrapper overhead; the browser suite separately exercises the real Next HTTP routes. Create and revoke workflow timings include their subsequent read. The corrected run must use this same scope and the unchanged latency/availability targets; sustained performance against the built image remains the explicitly later hardening gate.

Hardware was an arm64 Apple M4 Pro (14 CPUs, 48 GiB RAM), with Node 24.19.0 and Bun 1.4.2. Disposable services used the digest-pinned PostgreSQL 18.6 and OpenFGA 1.21.0 images from `infra/compose.yaml`. PostgreSQL had `fsync=on`, `synchronous_commit=on`, 128 MB shared buffers, 4 MB work memory and 100 maximum connections. Application/control data directories used the documented 1 GiB/256 MiB tmpfs mounts; these results are not a persistent-disk capacity claim. The raw report records exact images and container limits. A command-scoped sleep assertion kept the host awake; maximum observed event-loop lag was 15.11 ms against the 5,000 ms interruption threshold.

The run submitted **1,090,317 contextual checks**, with p95/p99/maximum context size seven tuples against the enforced limit of 100. It made **zero tuple-write requests**; independent reads verified zero stored permission tuples before and after the run. Projection attempts, abandoned generations and contextual graph cleanup work were all zero. Application storage grew by 202.875 MiB (including durable audit/outbox, receipts and soft-delete history); control database size did not grow. Application-cluster WAL increased by 875.159 MiB, and control-cluster WAL by 320 bytes, including warm-up. WAL positions are cluster-wide; the full report preserves per-relation sizes and measurement scope.

The matching non-root image is `sha256:0a8481229296bf460bdd46d5b08a6ddb0cdcbb2303102b6d3750b2c338d41b9f`. Its runtime acceptance passed on Node 24.21.0, including restricted child credentials, migration/readiness behavior, native dependencies, health and graceful failure/shutdown. The packaged `authz-upgrade` command is present; the real predecessor upgrade and interrupted publication/recovery-state cases are exercised by integration tests. See `artifacts/phase3/image-acceptance.json`, `image-policy.json`, `unit.xml`, `integration.xml`, and the build/browser/Storybook logs.

## Retained diagnostics

The actual API smoke used 25 RPC and 25 REST clients, 8-connection application/identity/control pools, real signed sessions and the full dataset. All 3,460 eligible operations succeeded without retry; p95 reads were 260 ms, writes 433 ms, create-to-readable 475 ms and fence waits 51 ms. This short result is diagnostic evidence, not the 30-minute gate.

The initial baseline had 60 passing unit tests and 72 of 74 passing integration tests. Two pre-existing identity MFA/passkey tests failed, then both suites passed on an unchanged rerun (31 tests). The initial report is retained at `artifacts/phase3/baseline-integration.xml`.

The first full-data performance smoke had 378/378 successful operations but failed latency and fence-wait budgets. Batching source reads improved a later smoke to 1,893/1,893 successful operations at about 123 operations/second, but that run still failed the read/write/fence latency thresholds. Profiling then exposed an index/order null-placement mismatch that caused a full hot-tenant list sort; the query now matches the index. These early diagnostics called services directly with 60-connection pools. Final evidence uses the normal API runtime's 8-connection pools, includes pool queueing in latency, and retains all 50 concurrent clients and the prescribed dataset/traffic distribution. Failed measurements remain diagnostic evidence, not acceptance. No Phase 0 benchmark result is substituted for the production feature gate.

The first sustained attempt was interrupted after the macOS host entered idle sleep for 237 seconds. The run retained 273,468 operations, including 43 availability errors and seven failed revocation probes around the pause. It also exposed 212 invalid-input errors from the harness reusing cold-tenant cursors after their 15-minute expiry. This run is not acceptance evidence (`authorization-benchmark-2026-09-26T16-52-25-719Z.json` and `host-sleep.log`). The harness now starts a fresh query for a cursor idle for five minutes, rejects long event-loop stalls, and runs under a command-scoped sleep assertion. No failed command is retried and no acceptance target is relaxed.
