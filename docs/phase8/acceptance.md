# Commercial template release candidate

Status: implementation under review; release acceptance and tag remain pending. The user requested separate PRs and explicitly prohibited merging them. This record prepares the release procedure without claiming acceptance of an unmerged candidate. The [roadmap](../06-delivery-roadmap.md) remains authoritative.

## Scope and compatibility

The release scope is the implemented Commercial template after accepted Phase 6/M2, using the exact [Foundation and Commercial-local presets](README.md). Provider-specific historical evidence keeps its recorded implementation and limitations; local provider simulators do not establish production provider availability or erase verification. Phase 7, M3 Enterprise and optional Backoffice release remain pending.

Shared changes are covered by both customer and Backoffice builds, image verification, security scanning and the existing operator regressions. This does not accept Backoffice version-pair deployment, reporting-load or operational release gates. Coordinate changes to the shared migrator, runtime email branding, build manifest, workspace dependencies and CI with the Backoffice owner.

No existing product release tags were found at implementation start. This candidate prepares the first tagged Commercial release. Populated predecessor schemas are development fixtures, not supported previous product releases. Both images embed current compatibility manifests; `phase8:compatibility` accepts only the reviewed current contracts, including when both supplied manifests contain the same unknown values. Applied migration hashes and timestamps must match current history; a local journal must be strictly ordered, and the migrator verifies the complete result. No applied migration SQL was changed. Unknown combinations require forward repair or the documented recovery protocol, never destructive down migrations.

## Implemented evidence paths

| Area | Command and evidence | Release condition |
| --- | --- | --- |
| Source and application | `phase8:verify source`, `unit`, `integration`, `browser`, `storybook`, `build` | Full source/types/unused-code, application suites, both production builds and Storybook/theme checks pass on the candidate. |
| Dependency policy | `phase8:verify security-dependencies` | Current high/critical policy passes; retain exact exceptions and scanner report. |
| Images | `image:build`, `image:build:backoffice`, then `phase8:image customer` and `phase8:image backoffice` | Immutable image IDs, runtime/native dependency/configuration/role/command acceptance and scans match candidate source. Unique target/attempt directories preserve both scans. |
| Sustained image load | `phase8:performance` | [Canonical full workload](performance.md), 30 measured minutes, unchanged targets, every tenant progresses, authorization correctness, Commercial jobs, usage visibility and cleanup pass. A smoke is insufficient. |
| Recovery | `phase8:recovery`, plus full integration | [Expanded faults](recovery.md), real worker termination before/after durable acknowledgement, exact-image restart and independent restore/security cases pass. |
| Compatibility | `phase8:verify compatibility`, plus both exact-image gates | Fresh/current/populated predecessor fixtures, immutable migration history and known manifests pass. No previous released-image rollback is advertised. |
| Accessibility | `phase8:verify accessibility`, plus full browser/Storybook | [Customer coverage](accessibility.md), English/Spanish and light/dark automated scans, keyboard/focus/status/dialog/responsive checks pass. Manual assistive-technology conformance is not inferred. |
| Template and skills | `phase8:template`, `skills:check`, reviewed skill applicability | Disposable presets, rename, interrupted/resumed/repeated setup and preserved customization/history pass. Retained independent authoring evidence needs an explicit source-delta audit; deterministic checks are not fresh live-agent trials. |

Raw attempts remain under ignored `artifacts/phase8/`; CI uploads them with the tested source. Failed attempts must remain visible. The implementation smoke failed write p95 under concurrent development load; its [retained record](performance.md#development-verification) is diagnostic evidence and does not waive the target.

## Implementation verification and remaining gates

All eight implementation PRs were opened before hosted CI was inspected. They remain unmerged. The following records establish implementation behavior at their stated sources; they are not a combined final-source release index.

| Evidence | Source and result | Retained record |
| --- | --- | --- |
| Full template adoption and skill applicability | `4bca5275e9e09bd58ec3b95d2a530a7dc12dc42a`: all ten adoption checks passed, including renamed frozen install/build/types, localized HTTP/email, real-service skill checks and preservation. Retained independent skill evidence was verified; zero fresh live-agent trials are claimed. | Receipts `a805a895-91b2-4967-a787-8cd4a3197967` and `95669628-6d3e-4491-ae9f-b7bfb7f857a6`. |
| Unit, compatibility and production builds | The same `4bca527` source passed 279 unit tests across 47 files, 13 real-database migration tests and both production builds. | Receipts `4ad9a608-ef9f-41d9-80fe-2302cea395c0`, `fc34d2bc-cdb3-492a-9d75-0e5af6fd9e0e` and `1971abb7-5192-4d2e-9813-c16666c22db4`. |
| Accessibility | `f9daa8278f4192f9b8013ec1e841beb7db71c39f`: four authenticated customer contexts, a fresh Storybook build and all 137 theme/story checks passed. Static preview replaced development HMR after a retained Axe context-destruction failure. | Receipt `ebb416ce-4ef3-4af5-a87a-ae62aedc0694`. |
| Exact images and recovery | Customer and Backoffice acceptance/scans passed at `f9daa827`; both worker termination barriers passed within their local diagnostic budget. Both images and recovery were rerun successfully at `789410fcd64d129b052418f7249168a50365754a` after harness scheduling changes. | Image receipts include `d7e08e5c-d117-41f5-b150-9eafc2dc9aa3`, `0f33bbda-29b4-4d63-af92-8ee23eeabd82` and `a9415062-2c29-4e3f-bfa3-0096eb5f3e24`; exact-source logs and recovery receipts remain under `artifacts/phase8/`. |
| Strict local smoke | `f9daa827`: 8,727/8,727 operations succeeded; read p95 183.55 ms and write p95 372.91 ms. All smoke gates passed. This is not sustained acceptance. | `performance-smoke-2026-10-22T18-32-48-675Z.json`. |
| Retained hosted CI | PRs #14–18 passed required CI. Before the approved CI contract change, runs for #19–21 passed the other jobs but failed strict smoke read/write latency on four-core EPYC 7763 runners: read p95 570–620 ms and write p95 1,148–1,205 ms. Those runs had 100% successful logical operations, progressing tenants and passing authorization, fence, job and usage checks. | Runs [39834172841](https://github.com/dani-beltran/saas-cook/actions/runs/39834172841), [39834173206](https://github.com/dani-beltran/saas-cook/actions/runs/39834173206) and [39834177066](https://github.com/dani-beltran/saas-cook/actions/runs/39834177066). |

The full attempt at `789410f` did not complete: after approximately 26 measured minutes, the shared development PostgreSQL container exhausted its 1 GiB tmpfs and stopped. Its last checkpoint recorded 538,198 submitted operations with 50 still in flight, read p95 159.10 ms and write p95 377.08 ms. An unhandled idle database-pool error prevented normal final evidence and cleanup. The checkpoint is not a completed or accepted run. The stopped tmpfs cluster lost its application and OpenFGA data; the existing containers were restarted with an empty cluster and OpenFGA migrations, without bootstrapping against or resetting the surviving control store. The incident record and failed logs remain in `artifacts/phase8/final/fixture-storage-failure*`; the original checkpoint is `performance-benchmark-2026-10-22T18-49-15-257Z.json`.

The remediation provisions private disk-backed services for every workload mode, checks free storage before and during work, catches idle and checked-out database failures, and binds service teardown and final source identity to the performance receipt. The combined implementation passed 115 focused tests, including actual ephemeral PostgreSQL socket disconnects, mandatory-gate failures, artifact tampering and direct-driver rejection, plus source, types and unused-code checks. Those deterministic checks do not establish an executed full workload; an isolated container failure drill and new sustained run remain required.

The user explicitly approved the [distinct CI correctness contract](ci-correctness-proposal.md) on 2026-10-22. Default CI retains strict failed latency receipts and separately assesses correctness; only read/write latency may be diagnostic there. Dependency health, cleanup, authorization, availability, workload fairness and all other budgets remain blocking. Ordinary smoke and the 30-minute full release gate retain their unchanged strict targets, and the release checker rejects CI correctness evidence in place of full performance. New CI results must be reviewed on the updated PR heads. Final merged-source evidence, acceptance review, roadmap sign-off and tagging remain pending.

## Release evidence checker

`bun run phase8:release --template` creates an incomplete index under `artifacts/phase8/`. Fill it with the actual receipt paths and SHA-256 hashes for every required gate. Then run `bun run phase8:release artifacts/phase8/release-input.example.json` from the clean candidate checkout.

The checker rejects missing/duplicate/failed/dirty/stale receipts, wrong presets, modified supporting artifacts and missing image identities. Performance and recovery must use the same immutable customer image as image acceptance, including architecture. Every receipt binds the same candidate commit and implementation fingerprint. The CLI records evidence integrity only; it always leaves `releaseAccepted: false` until evidence review, merged-main CI and roadmap sign-off occur. It never merges a PR, publishes an image or creates a tag.

The `skills` gate requires the independent evidence and its reviewed applicability. Run `bun run phase8:skills TEMPLATE_RECEIPT.json` after the full current-source template command. It validates the template receipt/report, successful real-service skill command, current audit and every supporting digest, then retains the original Phase 4/5/6 records and committed applicability review in a separate attempt. Its report explicitly records retained independent evidence and zero fresh agent trials. Smoke, stale, dirty, altered and deterministic-only inputs fail. `phase8:verify skills-contracts` deliberately emits a different gate. Manual review also verifies that commands, full workload duration, supported presets and documented limitations match the actual artifacts; a JSON assertion alone is not proof of execution.

## Merge and sign-off procedure

The opened stack is:

| Order | Work package | PR / current base |
| --- | --- | --- |
| 1 | P8-01 scope and evidence contract | [#14](https://github.com/dani-beltran/saas-cook/pull/14) → `main` |
| 2 | P8-02 image and evidence foundation | [#15](https://github.com/dani-beltran/saas-cook/pull/15) → #14 |
| 3 | P8-05 migration and compatibility | [#16](https://github.com/dani-beltran/saas-cook/pull/16) → #15 |
| 4 | P8-06 customer accessibility | [#17](https://github.com/dani-beltran/saas-cook/pull/17) → #16 |
| 5 | P8-04 failure and recovery | [#18](https://github.com/dani-beltran/saas-cook/pull/18) → #17 |
| 6 | P8-03 sustained image performance | [#19](https://github.com/dani-beltran/saas-cook/pull/19) → #18 |
| 7 | P8-07 template and skill workflows | [#20](https://github.com/dani-beltran/saas-cook/pull/20) → #19 |
| 8 | P8-08 candidate evidence and sign-off | [#21](https://github.com/dani-beltran/saas-cook/pull/21) → #20 |

1. Merge the scope/evidence contract, image foundation, compatibility, customer accessibility, recovery, performance, template and final evidence PRs in that order. The implementation stack uses one predecessor per PR to keep shared-file diffs reviewable; the work itself was implemented in parallel.
2. After each squash merge, restack the next PR onto updated `main`, retarget it to `main`, inspect its remaining diff and rerun required checks. Preserve the old base commit while restacking. Do not merge a child with an unresolved parent or stale checks.
3. On the final merged candidate, inventory tags again, install frozen dependencies, rebuild both images and run the declared release matrix. CI's manual `phase8_full=true` dispatch runs the sustained image workload instead of its smoke. Reserve an otherwise idle load host.
4. Review source changes since retained provider/skill evidence; rerun affected behaviors and record any justified applicability. Complete the evidence index and run `phase8:release`. Review actual reports and limitations as well as their hashes.
5. Record exact merged source, images, hosted CI, accepted results and operational limits in this record and the roadmap. Create the first release tag only after that sign-off. A subsequent implementation change invalidates affected evidence and needs review before inclusion.

No production SLA, disaster-recovery RTO, provider erasure completion, prior-product upgrade support, Enterprise acceptance or Backoffice release acceptance is implied by the local test budgets.
