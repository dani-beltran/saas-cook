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

## Release evidence checker

`bun run phase8:release --template` creates an incomplete index under `artifacts/phase8/`. Fill it with the actual receipt paths and SHA-256 hashes for every required gate. Then run `bun run phase8:release artifacts/phase8/release-input.example.json` from the clean candidate checkout.

The checker rejects missing/duplicate/failed/dirty/stale receipts, wrong presets, modified supporting artifacts and missing image identities. Performance and recovery must use the same immutable customer image as image acceptance, including architecture. Every receipt binds the same candidate commit and implementation fingerprint. The CLI records evidence integrity only; it always leaves `releaseAccepted: false` until evidence review, merged-main CI and roadmap sign-off occur. It never merges a PR, publishes an image or creates a tag.

The `skills` gate requires the independent evidence and its reviewed applicability, not a renamed `skills:check` result. `phase8:verify skills-contracts` deliberately emits a different gate. Manual review also verifies that commands, full workload duration, supported presets and documented limitations match the actual artifacts; a JSON assertion alone is not proof of execution.

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
