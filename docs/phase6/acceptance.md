# Phase 6 implementation and acceptance record

Date: 2026-10-19. Base: `79d2356819b2b690a1bf84d932ec2fa02de5b14b`. **Partial implementation; Phase 6 and M2 are not accepted.** No full Phase 6 provider, deletion or recovery acceptance is inferred from these results. Packaged-image regression checks below cover the existing image suite.

## Implemented and verified scope

| Requirement | Evidence in this checkout | Release status |
| --- | --- | --- |
| `R-SEARCH` | Real PostgreSQL full-text name search across registered Projects and example customers; current OpenFGA decisions; wrong-tenant/outsider/revoked cases; disabled types; bounded sparse scans; encrypted actor/tenant/query/page-size/type-bound cursors; strict snippets without email/description/totals; RPC/REST and localized browser journey | Implementation and scoped checks pass; full Phase 6 release remains pending |
| `R-ACTIVITY` | Separate tenant/source-constrained projection with allowlisted actions and generic actor labels; atomic source writes and deduplicated replay; stable pagination; current resource access; deleted/revoked resources denied; 90-day read/worker retention; audit preserved; real API/UI evidence | Implementation and scoped checks pass; full Phase 6 release remains pending |
| `R-KEYS` customer UI | Current-manage account/key metadata lists, bounded encrypted cursors, no secret/hash/recovery-epoch disclosure, existing fresh-auth issuance/rotation/revoke/deactivation services, one-time secret display; real browser proves the old key stops working on rotation and replacement stops working on revoke | Customer administration implemented; restored-key invalidation remains part of unimplemented `R-RECOVERY` |
| Private text files (partial `R-FILES`) | Real versioned S3, PostgreSQL/OpenFGA and browser tests: create-once constrained staging, immutable capture and exact-byte format scan, overwrites before/during/after scan, concurrent finalization/replay, current permission/revocation, capacity/reservation expiry, retention cleanup and proxy download | Supported text-file slice implemented; bulk imports/exports and full gate remain incomplete |
| Migration and role boundary | Fresh installations and populated Phase 5 predecessor upgrade/replay; unchanged old resources, audit/outbox and closed readiness; forced activity RLS, composite source FK, restricted worker cleanup | Scoped checks pass; migrations applied only to disposable test databases |

The maintained implementation is described in [README](README.md) and [the brief](../../feature-briefs/phase6-platform.md). No authorization model or legacy migration was changed. New migrations are `0011_phase6_discovery`, `0012_phase6_search_indexes`, `0013_phase6_activity_retention_index`, `0014_phase6_files` and `0015_phase6_file_reservation`. Earlier migration-count assertions were updated to include these additions; preservation assertions remain intact.

## Executed checks

- `bun run check`: passed without warnings.
- `bun run typecheck`: passed for root and web.
- `bun run knip`: passed.
- Initial discovery/key unit run: 159 tests passed. The final file-inclusive result is below.
- Focused real-service regressions (`packages/db/src/platform`, API platform transport tests and three predecessor migration suites): 18 tests passed after repairs.
- `bun run build`: passed, including standalone web and packaged worker/commands.
- `bun run test:e2e tests/e2e/platform.spec.ts`: two real-session browser journeys passed. Covers English desktop, Spanish mobile/dark, keyboard activity access, current deletion visibility, synthetic key issuance/rotation/revocation and one-time display.
- `bun run storybook:build`: passed, including loading/empty/error/recent activity stories.
- The discovery/key slice full integration run passed 186 tests; the subsequent file slice has its separate final regression run below.
- Static skill discovery passed after documentation reference repairs.

The initial full integration run had 181 passing and three failing tests: all three failures were stale expected migration counts. The failures and focused repair run are retained. Initial static skill discovery also found references to the rename brief removed by the base commit; those references now point to current compatibility documentation instead of restoring the deleted brief. An intermediate check ran before this acceptance file existed and failed that new link; the final check is separate.

Logs are retained under ignored `artifacts/phase6/`; browser reports/screenshots live under `artifacts/playwright-results/`. Only synthetic local accounts, local mail capture and disposable databases were used. Existing installations were not reset or migrated. No deployment, push, PR, live email or external provider operation was performed. The local checkout was already renamed to `saas-cook`; the chat's old `common-saas` path was absent.

## Remaining Phase 6 work

| Required module/gate | State |
| --- | --- |
| `R-FILES`: complete bulk-data scope | Immutable text files are implemented as documented in [files](files.md). CSV mapping/dry-run/duplicate rules/import chunks, export jobs and their full acceptance remain unimplemented; binary formats require another reviewed scanner. |
| `R-ACCOUNT`: personal closure, ownership continuity, credential removal, per-store cleanup and durable status | Not implemented |
| `R-ORG-DATA`: organization export/deletion, journal acknowledgement/cancellation, resumable purge and provider settlement | Not implemented |
| `R-RECOVERY`: independent retained journal/checkpoints, barrier/replay, restored credential replacement and exact access revalidation | Not implemented; existing readiness fail-closed behavior is preserved |
| `R-ANALYTICS`: authoritative preferences, typed catalogue, reports, bounded queue, tested PostHog integration and deletion/suppression barriers | Not implemented |
| General notifications/preferences, outgoing webhooks, integration credentials, flags | Not implemented |
| Dedicated audit query/export, help and public UI | Not implemented |
| Complete Commercial `R-IMAGE`, hosted CI and Phase 6 acceptance | Current packaged baseline image suite and dependency/image vulnerability gates passed locally. Complete Commercial module image scenarios and hosted CI remain unrun; Phase 6/M2 remain unaccepted. |

These are remaining implementation requirements, not optional provider configuration or completed features. The roadmap remains in progress until they and their acceptance evidence are delivered. Optional Backoffice remains outside this customer application change.


## File slice diagnostics

The first file integration attempt failed during migration: generated SQL added a
foreign key before its new referenced unique constraint. The reviewed additive SQL
now orders the unique constraint first. No ambient database was migrated. Four file
integration tests then passed; a fifth adds overwrite during scanning. Initial Knip
found the new Drizzle schema entry missing; its exact entry was added. The real
browser upload/verification/download test passed against a disposable private S3
bucket, with Spanish mobile visual inspection and no horizontal overflow. The
format validator supports UTF-8 text only; it does not claim general malware scanning.


## Final local verification

- Source/format, root/web TypeScript and Knip passed. Restored the build-generated
  `next-env.d.ts` to its original tracked content and rechecked types.
- Static skill checks passed all four checks. One intermediate DTO check rejected
  an unbounded upload-header dictionary; it is now a strict three-field allowlist.
  The corresponding unit failure and repair logs are retained.
- Unit suite: **160/160 passed** (`latest-unit.log`).
- Full real-service integration suite: **193/193 passed in 29 files**
  (`final-integration.log`). Subsequent review added a file-expiry-during-read case,
  persisted scan evidence and narrower SQL column grants. The final focused file
  and predecessor-upgrade run passed **7/7** (`files-final-roles.log`); API/file
  review regressions passed **10/10** (`files-reviewed.log`). The entire integration
  suite was not rerun after those focused final changes.
- Nine affected browser journeys passed across platform (2), files (1), Projects
  (3) and example customers (3). The final file journey was rerun after the scan/
  expiry repair. Source checks verify unchanged migration history; only disposable
  test installations received the new migrations.
- Production web/worker/command build and Storybook passed.
- `TEST_IMAGE=saas-cook:phase6-platform bun run image:build` and `bun run test:image`
  passed **16 existing packaged-image checks** on the final source fingerprint.
  This proves the current image/runtime boundaries, not the missing Commercial
  recovery or bulk-data workflows. [Image evidence](evidence/image.json).
- Pinned Trivy 0.69.3, using a freshly downloaded vulnerability database: dependency
  and exact-image policies passed with no blocked findings and no new exceptions.
  [Security decisions](evidence/security.json). Full reports remain in ignored
  `artifacts/security/`; scan logs are in `artifacts/phase6/`.
- `git diff --check` passed. No commit, push, deployment or PR was made.

Implementation fingerprint:
`d0b3b21166f0716685da3ced4211996051dea487e33b9384d9e835ea9cd21ce1`.
[Source, skill/brief hashes and exposed agent configuration](evidence/source.json).
The preserved image is `saas-cook:phase6-platform`, digest
`sha256:c1d41f90b52e080fd0779886ad16cafb5f208f9fdb6879cf5cc74447bdff7ca4`.
No tests or evidence in this record establish that the remaining Phase 6 work is complete.
