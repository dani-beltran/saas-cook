# Template adoption and authoring evidence

`bun run phase8:template` runs a complete disposable adoption check. `--smoke` runs only source/configuration and static skill checks. Each attempt writes an immutable report, command logs and a hashed `template` or `template-smoke` receipt under `artifacts/phase8`. A smoke receipt cannot satisfy the full release gate. Failed attempts stay failed. Full receipts describe the checked checkout; the release integrator must rerun after shared changes on the clean final source.

## Executed workflow

The command exercises the actual runtime validator for the Foundation, Commercial local and Commercial provider presets declared in the Phase 8 scope. Foundation needs no optional-provider credentials. Commercial local enables files/platform with distinct storage, lifecycle and independent journal roles. Commercial provider additionally validates Stripe test and analytics settings. Synthetic provider values validate configuration only: they never contact or prove acceptance by Stripe/PostHog. Unknown presets, invalid booleans, mismatched flags, incomplete enabled-module credentials, privileged runtime roles and analytics without platform fail closed.

The source fixture reuses the Phase 4 evaluator's credential/generated-file filters and restores tracked evaluator tooling and history needed by a complete downstream repository. It writes an explicit disposable marker before mutation. The fixed Northstar Work example changes root/workspace manifests, lockfile workspace names, imports, application/UI branding defaults, runtime email examples, environment example, build filters and active image references. It is a verification fixture, not a general product generator or a module activation DSL.

A seven-file checkpoint simulates interruption. Resume preserves completed edits; a satisfied repeat produces zero changed files. The check hashes applied SQL and migration snapshots, authorization model/history, skills, historical evaluation records and Phase 0 fixtures. Existing `.env` bytes and an unrelated developer-owned source customization remain unchanged. Fresh `.env` initialization is allowed only when absent. Internal database roles, installed data, ingress signing domains/headers, Stripe idempotency namespace, telemetry and synchronization identifiers, and source-fingerprint OCI label names are intentionally retained. Renaming a product does not authorize changing deployed protocol or database identities.

Full verification performs a real frozen Bun install in the renamed copy, customer production/runtime bundle build, strict types for all applications, both localized email tests, and English/Spanish HTTP checks against the standalone production server with a distinct runtime `APP_NAME`. The preview renders a validated explicit `APP_NAME` through `publicConfig`, escapes HTML and preserves plain text. Existing no-argument branding defaults remain supported. The preview has no delivery trigger; identity and billing delivery behavior is unchanged.

Full `skills:check` then executes source contracts, migration-history controls and existing real-service integration boundaries on isolated database fixtures. Its authorization suite proves fresh bootstrap, completed repeat, interrupted-bootstrap receipt resume without epoch reset, and rejection of populated/restored or mismatched initialization. Its data/API suites preserve developer-owned feature behavior and tenant/role boundaries. These are actual assertions, not a transcript of an agent authoring a new product.

## Retained independent-agent evidence applicability

No new live-agent trial is claimed. The retained [Foundation trials](../phase4/evidence/release.json), [Commercial trials](../phase5/evaluation-2026-10-19.json) and [Phase 6 trials](../phase6/evaluation.md) remain bound to their original task sets, source hashes and actual model/session metadata. P8-07 supplies an explicit delta review plus fresh deterministic application checks; it does not relabel those trials as execution on the final release source.

The audit compares every canonical skill against a reviewed SHA-256 allowlist and records all differences from the Phase 4/5 skill hashes and Phase 6 reference hashes. Future canonical-skill edits fail this gate until their applicability is reviewed and, when authoring semantics change, applicable independent trials are rerun. Merely updating a hash is not an evaluation.

| Delta | Applicability decision and affected verification |
| --- | --- |
| `636269a` moved feature briefs under `docs/feature-briefs` | Five Phase 5 skill hashes differ only in corrected links and brief location; `saas-verify-feature` is identical. Bootstrap now links to the existing compatibility-identifiers section instead of the retired rename brief. Full diff against `7ebc9c4` was reviewed. No behavior/authorization instruction changed. Static discovery checks verify the current links. |
| Backoffice additions to AGENTS/architecture/data/billing references | The new staff identity and private deployment are an explicitly separate scope. Historical customer authoring claims do not accept Backoffice. Both apps remain in renamed type checking; optional Backoffice release gates remain open separately. |
| Analytics reference update | Current durable asynchronous erasure verification, backoff and forced-fresh provider queries extend application runtime behavior. Existing skills still require canonical lifecycle/recovery services. Full skill integration regressions cover current local analytics/recovery contracts; the historical provider subject remains pending and the cancelled manual drill is not reinstated or claimed passed. |
| P8-05 migration history guard and initial-release contract | Bootstrap/evolve/verify workflows already require immutable applied history and refusal to initialize restored data as fresh. The guard enforces that existing rule before mutation. Rerun current migration negative controls and authorization initialization tests; exact image/schema/control/model compatibility remains P8-05 evidence. There is no previously released binary upgrade/rollback claim. |
| P8-06 accessibility fixes and P8-07 preview branding | Existing dashboard/email skills already require localized accessible states and escaped rendering. Axe/keyboard/browser and email-render tests cover the affected behavior; no new domain schema, authorization lifecycle or authoring language is introduced. |

The recorded Phase 6 reference deltas include AGENTS, architecture, data model, billing operations, skill-document tree and analytics. The report enumerates the measured current hashes rather than pretending those references are identical. Final release review must also assess subsequent shared-code deltas. New provider contracts, migration/model authoring semantics, skill changes or new domain requirements require affected independent trials; deterministic checks alone cannot establish agent reliability.

## Subsequent source-delta review (2026-10-22)

The retained full template/skills source `4bca5275e9e09bd58ec3b95d2a530a7dc12dc42a`
was compared with the integrated Next.js repair at
`1ce237f0011c5fb196d349c4c213fefce8df168a` (40 changed files). This review also
covers toolchain fix `5e6e1c47f8adcf9517efdc8d68c58c5ad91e6292`, incorporated in
the template lane as `5c3c2b9`. All six canonical skill files and the three retained
Phase 4/5/6 evidence JSON records remain byte-identical across that comparison.
Task briefs, held-out evaluators, migration history, authorization models,
application domain/DTO/UI source, AGENTS and architecture/data/billing/skill
contracts are unchanged. Of the 13 measured Phase 6 reference files, only
`docs/development/verification.md` changed: it adds the existing theme test after
the Storybook build and requires rebuilding when inputs change.

| Changed paths | Applicability decision and required verification |
| --- | --- |
| `scripts/phase8/performance*`, `infra/phase8/compose.performance.yaml` | Correct tenant scheduling, bounded polling, private disk-backed services, image networking, dependency failure handling, cleanup and source/artifact binding change the workload harness, not feature-authoring semantics. Run focused harness regressions and fresh exact-image smoke/full gates. Historical Phase 4 authoring evidence explicitly excludes the performance benchmark. |
| `packages/testing/src/{installation,pool,file-storage}.ts`, `scripts/phase3/fixture.ts` | Optional static failure callbacks/SQL bounds, bounded cleanup and an explicit local storage endpoint preserve existing default SQL settings, roles and service composition. No grants, schema or domain invariants change. Current real-service skill checks exercise these fixtures; dedicated disconnect/cleanup tests cover their new failure paths. |
| `.github/workflows/ci.yml`, root command/Knip/Turbo configuration, `scripts/phase8/{performance-ci*,release-check.test.ts,verify.ts}` | The approved CI correctness mode retains strict failed measurements and cannot satisfy full performance acceptance. Registration, immutable supporting evidence and release rejection need deterministic tests and hosted CI, without changing authoring tasks or waiving the strict full gate. |
| `playwright.theme.config.ts`, `tests/{e2e,theme}/accessibility.spec.ts`, `docs/development/verification.md` | Immutable Storybook preview, bounded initial rendering and the exact existing privacy-link assertion repair test execution. The additional verification command clarifies the existing accessible-dashboard/email requirement; it introduces no authoring API or domain requirement. Rebuild Storybook and rerun theme/browser accessibility checks. |
| Root, customer, Backoffice and executable Phase 0 manifests; `bun.lock`; `security/README.md` | Next.js 16.4.1 repairs the recorded security findings with coordinated environment/SWC packages. No application code adopts new framework APIs and no skill instructions change. Fresh frozen installation, application builds/types/browser checks, dependency/image scans and affected Phase 0 checks must validate the new runtime graph. |
| `scripts/phase0/{toolchain,toolchain-packages}.ts`, `scripts/phase8/toolchain-packages.test.ts` | The toolchain verifier now distinguishes existing `workspace:*` links from published versions. It requires one declared source, the actual symlink target and matching package identity/version; external dependencies still require exact manifest and installed versions. Negative controls reject missing/duplicate/substituted workspaces and floating/mismatched external pins. This repairs verification of the existing workspace layout without changing feature-authoring semantics. |
| `docs/phase8/{acceptance,accessibility,performance,ci-correctness-proposal}.md` | These record operational scope, failed attempts and acceptance distinctions. They introduce no provider, migration/model or domain-authoring requirements. |

This delta does not require fresh live-agent trials for the explicitly limited
retained-evidence claim. It does require fresh deterministic and runtime evidence
on the final clean source. Full template CI invokes renamed frozen installation,
customer production/runtime HTTP checks, all-application types, localized email
checks and full real-service `skills:check`; it does not replace the separate
benchmark, browser/theme, image/security or Phase 0 checks. This review records
applicability, not successful execution of those reruns.

The source-bound `skills` receipt must use a new full template receipt and bind
this committed review. It must continue to report `freshAgentTrials: 0` and the
original historical task/source/model limitations. Neither this review nor
current deterministic passes claim that an agent authored a feature on Next.js
16.4.1. New authoring semantics, task requirements, provider/model contracts or
supported agent/model changes still require applicable independent trials.

## Acceptance boundaries

The required CI integration job runs the full command after its application suite. It retains attempt reports, logs and receipts while excluding the large disposable candidate installation from uploads. Source commit, fingerprint and dirty state must remain stable during verification.

The full command requires disposable PostgreSQL/OpenFGA/S3 services already running. It does not stop services, reset ambient installations, send live notifications, provision production, poll historical provider deletion or run hosted CI. It preserves earlier attempts under unique artifact directories. Candidate dependencies/build output are ignored evidence and can be removed after inspection. Production-image compatibility, sustained workload, recovery faults, human assistive-technology review and final clean-source release acceptance belong to their separate gates.


## Local implementation evidence

On 2026-10-22 the full implementation run passed: 28 preset/email assertions; frozen renamed installation; customer build/runtime packaging (54 seconds); renamed strict types and 12 email assertions; and full `skills:check` with 65 guard unit and 175 real-service integration cases (195 seconds). The independent en/es standalone HTTP supplement passed with `Northstar Runtime Product` supplied at startup. The subsequent smoke run passed the final custom TypeScript preservation and source-continuity checks. Source/strict-type/frozen-install checks also passed. Earlier controller failures (catch-all route filename validation and initially unreviewed relocated skill links) remain retained and were repaired without changing application boundaries.

Evidence is under `artifacts/phase8/template/5d05732f-c2f7-45d1-8970-ff16b6ad0032/` and `artifacts/phase4/checks/1792691646734-a3ec8ef0-1176-4dff-a236-a4443be0b284/`. These are development-source results, not a final clean-source release receipt. The integrated P8-05/P8-07 source must run the final command again so the renamed bundle also exercises the newly embedded compatibility manifest and migration guard.
