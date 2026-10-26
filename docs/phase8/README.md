# Phase 8 Commercial release contract

Status: implementation in progress; acceptance pending. The [delivery plan](development-plan.md) identifies P8-01–08. The [roadmap](../06-delivery-roadmap.md) remains the acceptance authority. Work is delivered through unmerged PRs; final merged-source checks and tagging follow review and merge.

## Presets and support

| Preset | Runtime flags | Scope |
| --- | --- | --- |
| `foundation` | `BILLING_ENABLED=false`, `FILES_ENABLED=false`, `PLATFORM_ENABLED=false`, `ANALYTICS_ENABLED=false` | Identity, organization/team/Project permissions, seats/local capacity, usage enforcement, API keys and identity mail. No provider credentials required. |
| `commercial-local` | Files and platform enabled, billing and analytics providers disabled | Real disposable PostgreSQL/control store/OpenFGA/S3, restricted roles, bulk jobs, lifecycle/journal/recovery, discovery/activity, settings and notifications. Provider behavior uses separately labeled deterministic adapter tests. |
| `commercial-provider` | Files/platform plus configured Stripe test mode and analytics adapter | Actual provider supplements require scoped test credentials. Local success does not prove provider erasure or production service guarantees. No live charging or production data is authorized. |

These names describe evidence configurations, not a new runtime configuration DSL. The existing server validators and module dependency checks remain authoritative. Backoffice, Enterprise identity/governance, metered charging and unimplemented adapters are excluded from Commercial release acceptance. Existing Backoffice regression CI remains required.

## Upgrade baseline decision

On 2026-10-22, fetching `origin/main` and all tags returned main `6cc5156` and no release tags. Existing CI also explicitly records that no product release exists. Phase 8 therefore prepares the **first tagged Commercial release**; no upgrade from a previously released product or older image pair is advertised. P8-05 must test populated predecessor schemas and preserve current custom code/data. Those tests are developer-baseline compatibility, not a released-product support claim. The release checklist must repeat the tag/baseline inventory before sign-off in case a release appears during this work.

Initial schema support is the current reviewed application migration journal and current control schema/model contract. Binary rollback is permitted only when the declared schema/model/event contract is compatible; otherwise use forward repair or canonical recovery. The first accepted tag becomes the immutable baseline for future product upgrades. Do not create that tag before the merged candidate is accepted.

## Gate ownership and checks

| Requirements | Owner | Required checks |
| --- | --- | --- |
| Required stack, source/types/unused code | P8-02/08 | Frozen Bun install; `check`, `typecheck`, `knip`, commitlint, credential-free customer/BO production builds and Storybook. |
| `R-IMAGE` | P8-02/05 | Both exact image checks/scans for shared changes, source/image binding, runtime/native dependency/configuration/role checks, startup/drain and packaged commands. |
| `R-TENANCY`, `R-LIFECYCLE`, `R-AUTHZ`, `R-KEYS`, `R-OWNER`, `R-TRANSFER` | P8-04/05/08 | Full unit/integration and current browser suites; real restricted roles, current contextual authorization, final expiry guards, late response/revocation/recovery denials and schema/model upgrades. |
| `R-PASSWORD`, `R-MAGIC`, `R-PASSKEY`, `R-EMAIL` | P8-06/08 | Identity/email integration and localized browser journeys, current assurance, lifecycle/epoch/expiry, accessibility and independent BO cookie/identity regressions. |
| `R-POLICY`, `R-SEATS`, billing and durable usage | P8-03/04/08 | Monetization integration, provider replay/outage/admission races, immutable ledger, local/paid intersection; applicable provider evidence separately bound to its implementation. |
| `R-AUTHZ-PERF` | P8-03 | Existing service benchmark remains distinct from new sustained actual-image HTTP benchmark; full load plus sparse reader, revocation and Commercial contention/fairness. |
| `R-SEARCH`, `R-ACTIVITY`, `R-FILES`, `R-ANALYTICS`, `R-ACCOUNT`, `R-ORG-DATA`, `R-RECOVERY` | P8-04/06/08 | Existing Commercial integration/browser suites plus new worker interruption, retries, independent restore/security and provider-suppression failures. |
| Accessibility and complete UI states | P8-06 | Automated checks plus keyboard/focus/error/status/contrast review of enabled journeys, English/Spanish, light/dark and mobile; shared BO regression. |
| `R-SKILLS`, presets and rename | P8-07 | `skills:check`, disposable setup/rename/resume/repeat checks and applicable independent Phase 4/5/6 evaluations or a justified source applicability audit. Never relabel deterministic execution as live authoring. |
| Upgrade/customization compatibility | P8-05/07 | Current and populated predecessor fixtures, migration hash preservation, model/control compatibility, explicit supported/unsupported rollback and preserved developer customizations. |
| Release completion | P8-08 | Every due row above has evidence or is explicitly blocked; exact merged-source hosted CI and release matrix. No skipped gate is success. |

Retired `R-WORKSPACES` is historical. Enterprise and Backoffice gates remain separately pending for their enabled release scopes.

## Measurement budgets

Preserve the canonical workload: 100 tenants, 1,000 memberships, 100,000 Projects; 50 clients; hot organization owns half the resources and receives 80% of requests; direct-Project 60/20/10/10 read/update/create-delete/share-revoke mix; at least 30 measured minutes after warm-up. Reads p95 <500 ms, writes <800 ms, authorization readiness and create-to-readable <2 s, fence waits <100 ms, first-attempt eligible success ≥99.9%, usage visibility p95 <60 s. Record p99/max and retries separately. Deliberate denials do not inflate eligible success. Smoke runs cannot accept this gate.

Expanded fault fixtures use a **60-second local recovery observation budget after dependency restoration**. This bounds the test and exposes non-convergence; it is not a production RTO. Retain timeout/queue/retry and before/after durable-acknowledgement evidence, including failed attempts. Restore protocol failures must keep access closed regardless of elapsed time.

## Evidence interface and coordination

Implemented P8-02 commands: `bun run phase8:image customer` and `bun run phase8:image backoffice` run existing exact-image behavioral checks and the existing security policy against the resolved immutable image ID. Build with `image:build` or `image:build:backoffice` first. The wrapper requires current source labels and writes exclusive versioned pass/failure receipts. CI uses these wrappers and retains their receipts; the Storybook job also runs browser theme/keyboard checks. This does not create a release publication path or a signed provenance claim.

P8-02 supplies `scripts/phase8/evidence.ts`: a versioned receipt records gate/preset, start/end times, outcome, current source commit and implementation fingerprint, optional exact image identity, command labels, checks and limitations. Evidence writers must sanitize labels and never retain environment values or command secrets. File digests bind supporting artifacts. Failure receipts are retained; no caller can manufacture success from missing checks. P8-03/04/05 consume the interface or attach existing reports through it without changing workload semantics.

Raw artifacts live under ignored `artifacts/phase8/`; committed summaries point to fingerprints and durable CI artifacts. The integration owner handles CI/root files and migration/model coordination. Feature agents work in separate managed worktrees. Final combined evidence is evaluated after all PR implementations exist, as requested; hosted CI is not awaited between PRs. P8-08 remains pending sign-off until the merged release candidate is checked. Backoffice development does not depend on a Phase 8 release tag.
