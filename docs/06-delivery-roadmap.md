# 6. Delivery roadmap

## 6.1 Delivery strategy

Build a working vertical slice before expanding the catalogue. Prove identity, tenant isolation, resource permissions, a real database transaction, a dashboard operation, audit, and asynchronous delivery together. Implement provider-independent entitlement/capacity and service-principal primitives before the reference feature's acceptance suite. Extract AI agent skills from the proven slice after authorization safety and availability gates pass, then use them for subsequent modules. Validate resulting code with deterministic tools and evaluate skill behavior separately.

[Phase 0 validation](phase0/README.md) is complete for the template scope. The contextual authorization replacement passed its fault suite and full reference gate; the failed full-copy candidate remains rejected. Infrastructure operation and recovery-time commitments are outside scope. Application and image acceptance are recorded separately for each implemented phase.

The [September 23 authorization rerun](phase0/authorization.md#rerun-with-increased-memory-and-tmpfs-capacity) stopped at the retained-generation tuple guard despite an 8 GiB tmpfs. The subsequent [snapshot-retention fix](phase0/authorization.md#snapshot-retention-fix) passed 21 authorization tests and kept terminal snapshot payloads at zero under reference load. Its run instead stopped at the unchanged 6 GiB storage guard after 51 measured seconds, dominated by OpenFGA storage. The subsequent [contextual replacement](phase0/contextual-authorization.md) passed 33 tests and completed 1,821.6 measured seconds with 99.950% first-attempt success, all original latency/deadline thresholds satisfied, zero persisted graph writes and about 658 MiB of database-plus-WAL storage. Authorization is no longer the open Phase 0 blocker.

Phase 1 repository/runtime implementation and its verification record are documented in [the Phase 1 guide](phase1/README.md). Phase 2 adds production identity, tenancy, contextual authorization and initialization; its [acceptance record](phase2/acceptance.md) maps the implemented services and executed checks to the Phase 2 gates. The [Phase 3 implementation and acceptance record](phase3/acceptance.md) tracks the accepted direct-Project performance gate alongside historical resource authorization, Workspace, service-key and capacity evidence.

Phase 3's real-feature `R-AUTHZ-PERF` gate **passed** in the [manual 2026-09-27 run](phase3/acceptance.md#accepted-direct-project-performance-result): **524,149/524,149 operations**, zero retries, **1,800.678 measured seconds**, **291.08 operations/second**, and all latency targets met on stable source. The `direct-project-v1` workload retains the 60/20/10/10 read/update/create-delete/share-revoke mix, 100,000 Projects and 50 clients; 27,238 shares confirmed allowed reads and 25,163 revocations confirmed denial. The [direct-Organization Project design](../feature-briefs/remove-workspaces.md) retires Workspace parent moves; earlier results remain predecessor evidence. Current-image/security checks, refreshed skill evaluations and hosted CI now pass in the [M1 Foundation acceptance record](foundation/acceptance.md). The benchmark excludes TCP/Next wrappers and the later sustained-image performance gate.

Phase 4's [authoring skills and deterministic checks](phase4/README.md) pass the refreshed `R-SKILLS` gate: all ten tasks pass in both independently authored candidates, including real-service checks, captured interruption/resume, source-preserving repeated requests and separate security review. The [current acceptance record](phase4/acceptance.md) preserves the earlier exception and failed attempts as historical evidence. The full Phase 3 benchmark was already accepted before these new trials.

**M1 Foundation (Phases 0–4) is accepted**, with the [due-only sign-off below](#m1-foundation-sign-off-2026-09-27). The optional [Backoffice plan](backoffice/development-plan.md) remains a separate, unimplemented Phases 5–8 track. BO-00 must assess current Foundation evidence for its proposed changes and ratify its architecture; Foundation acceptance does not accept Backoffice behavior.

**Phase 5 is completed and accepted for its documented scope as of 2026-10-19.** Its additional `R-SKILLS` gate [passed on 2026-10-19](phase5/evaluation.md): two independent candidates pass the five declared Commercial tasks, preserved repeats/resume, evaluator-owned checks and actual Stripe test-API supplements on their recorded SDK 22.6.2 baseline. The subsequent final-source hosted Checkout repeat passed all 11 checks with Stripe SDK 23.0.0 / `2026-09-30.endive`. [Phase 5 hosted CI and current dependency/image security gates](phase5/acceptance.md#hosted-ci-and-security-gate--completed-2026-10-19) passed in [run 39271661736](https://github.com/dani-beltran/saas-cook/actions/runs/39271661736); M2 Commercial still requires Phase 6.

**Phase 6/M2 Commercial acceptance remains open after the 2026-10-21 closure audit.** [Requirement-by-requirement results](phase6/acceptance.md#m2-closure-audit--2026-10-21) record current source/types/Knip, 179 unit cases, 220 real-service integration cases, 53 browser cases, six skill-boundary checks, builds, 17 exact-image checks and both vulnerability policies passing. The fresh Stripe test-mode deletion/settlement/continuing-tenant drill passes 7/7; both fresh independent Commercial candidates pass the five declared module tasks, all nine heldout cases and preservation/repeat/resume in the [Phase 6 evaluation](phase6/evaluation.md). The full final-source authorization gate passed 467,808/467,808 operations over 1,800.41 measured seconds, with zero retries and all latency targets met; the earlier host-disk-exhaustion failure remains retained. Actual PostHog erasure and the dependent live late/uncertain-ingestion completion drill remain blocked: the existing synthetic deletion still has no verified completion. The [2026-10-22 PostHog investigation](phase6/posthog-deletion-investigation.md) confirms correct identity/configuration and matching provider/API pending status after 21.95 hours; the deployed Cloud queue schedule still needs provider confirmation. Local application recovery passes; production infrastructure guarantees are not inferred. [Hosted CI run 39627583945](https://github.com/dani-beltran/saas-cook/actions/runs/39627583945) passed all nine jobs for published implementation `94fbb74`, including browser/required and current dependency/image policies; the earlier base failure is retained as historical. Phase 7, Phase 8 hardening and optional Backoffice remain outside this milestone.

## 6.2 Phases and acceptance gates

| Phase | Deliverables | Depends on | Exit gate | Effort estimate |
| --- | --- | --- | --- | --- |
| 0. Validate decisions | Threat model; required-stack dependency/license/version matrix, including React 19 and Bun workspace compatibility; oRPC/Zod/Next.js adapter spike; magic-link/passkey assurance and ownership/account-lifecycle race spike; RLS/pool spike; contextual OpenFGA prototype plus historical generation regressions; hot-tenant benchmark; independent recovery-store design; billing/storage/analytics adapter feasibility; Docker image build inputs and packaging ADR | This plan | Required technologies have compatible versions and mappings; late-write fault suite and healthy availability budgets pass; recovery application protocol, immutable-object contract and image packaging documented | 3–5 engineer-weeks |
| 1. Repository and runtime | Bun/Turborepo; Next.js/React 19/TypeScript/shadcn/ui/Tailwind shell; next-intl/forms/Storybook patterns; worker; local services; T3 Env; oRPC skeleton; GitHub Actions and quality toolchain; AGENTS.md; combined application image and command packaging; LogTape/OpenTelemetry; test fixtures | 0 | Required-stack gates and image portion of `R-IMAGE` pass with synthetic data | 2–4 |
| 2. Identity, tenancy and authorization primitives | Better Auth/MFA/sessions, email/password registration and reset, magic links, passkeys and identity emails; organizations/members/invitations/teams and ownership transfer; tenant context/RLS, audit/outbox, local policy/seat admission; selected production graph protocol for organization/team roles, lifecycle/authorization fences, independent epoch/readiness and fresh model bootstrap; owner-recovery command and account/org UI | 1 | `R-TENANCY`, `R-LIFECYCLE`, `R-AUTHZ`, `R-SEATS`, `R-OWNER`, `R-PASSWORD`, `R-MAGIC`, `R-PASSKEY`, `R-TRANSFER`, `R-EMAIL` and Phase 2 `R-IMAGE` pass against real services; recovery/transfer complete graph publication | 5–8 |
| 3. Resource authorization and reference feature | Extend the Phase 2 protocol to Projects directly under Organizations; direct member/team/service grants; service-account/API-key enforcement/provisioning; generic capacity reservations; Project CRUD and feature-local search/pagination; oRPC/Zod contracts, typed client, public OpenAPI and concurrency | 2 | `R-KEYS`, `R-POLICY` and real-feature `R-AUTHZ`/`R-AUTHZ-PERF` pass; both API transports use the same policy and concurrency boundary | 4–6 |
| 4. AI agent skills | Bootstrap/add/evolve/verify feature skills, dashboard/email skills, feature briefs, shared references, discovery adapters and isolated behavior evaluations; deterministic migration/RLS/API checks | 3 | Agent implements Project + child Task and service-account variant; held-out behavior suites pass without commercial credentials; evolution/resume preserves custom code/data/history; repeated requests add no duplicate artifacts | 3–5 |
| 5. Monetization | [Implementation and evidence](phase5/acceptance.md); completed and accepted for its documented scope; historical evaluation limits remain documented. Plans, Stripe fixed/seat billing, Checkout and Customer Portal, webhook inbox, commercial entitlement sources, ledger/windowed quotas, usage dashboard, reconciliation and notices; shared services support optional BO-04 finance/dunning integration | 4 | Stripe lifecycle and replay/out-of-order tests pass; provider downgrades and admission races converge; no duplicate semantic charge or usage; enabled Backoffice adds its own gates in §6.7 | 4–6 |
| 6. Platform modules and baseline recovery | Files/import/export; cross-resource search and resource activity feeds; personal/organization deletion and independent journal; analytics events/reports/controls/cleanup; recovery with credential replacement and independent access revalidation; notifications/API-key UI/webhooks/integrations/flags; audit/help/public UI; BO-05/06 reuse these services | 5 | `R-SEARCH`, `R-ACTIVITY`, `R-ANALYTICS`, `R-ACCOUNT`, `R-FILES`, `R-ORG-DATA`, `R-RECOVERY` and Commercial `R-IMAGE` pass for Commercial modules; operator UI cannot replace domain acceptance | 6–9 |
| 7. Enterprise administration | OIDC/SAML, SCIM, custom roles, security policies, guests, contract overrides, advanced operator governance and optional delegated support, advanced retention/legal-hold hooks; minimal Backoffice boundary/read UI is pulled forward through BO-01/02 | 6 | Real IdP deprovisioning is organization-scoped, including sole owner; SCIM uses shared seat admission; recovery/support/policy actions fully audited; support remains separately gated | 4–7 |
| 8. Hardening and template release | Expanded performance/failure/recovery tests, accessibility, previous-release compatibility, bootstrap presets and image verification; BO-07 adds enabled dual-image compatibility/isolation/reporting evidence | 7 | All applicable application and image gates pass; tagged template release with documented limitations; enabled Backoffice passes §6.7 release gate | 3–5 |

The previous **34–55 engineer-week** baseline and **2–4 engineer-week** recovery addition predate the image-only scope and validated authorization replacement. Re-estimate implementation before treating these as a delivery schedule; no revised total is claimed here. Phase estimates above are provisional.

Milestones:

- **M1 Foundation:** Phases 0–4. Runnable foundation preset, reference domain, real local entitlements/capacity, service-principal enforcement, and evaluated agent skills; full commercial/export/account-deletion workflows are outside this milestone.
- **M2 Commercial core:** through Phase 6. A product can sell subscriptions and operate common SaaS workflows after demonstrating application recovery tests, personal account deletion/ownership continuity, organization export/deletion, analytics controls, and the applicable module suites.
- **M3 Enterprise baseline:** through Phase 8. Enterprise identity/governance and application recovery have been demonstrated.

### Required-stack delivery gates

All 26 selections in [architecture §2.1](02-architecture-and-security.md#21-stack-decisions) are required. Phase 0 resolves compatible versions; implementation and acceptance follow these gates. Re-estimate Phase 1 after validating the full toolchain and its compatibility work.

| Stack area | Delivery phase | Acceptance evidence |
| --- | --- | --- |
| Next.js, React 19, TypeScript, Bun | F / 1 | Clean clone installs from `bun.lock` with a pinned Bun version; strict typecheck and production build pass on the supported Node.js runtime |
| shadcn/ui, Tailwind CSS, next-intl, React Hook Form, Zod, Storybook | F / 1 patterns; F / 3 Project | Shared accessible form and theme/locale stories build; localized rendering and validation states pass; Project reuses the patterns |
| Drizzle ORM, PostgreSQL, Better Auth, React Email | F / 1 setup; F / 2 identity/tenancy | Reviewed Drizzle migrations run under separate roles; self-hosted sign-in and localized identity email journeys pass against real local services |
| oRPC and Zod API contracts | F / 1 skeleton; F / 3 full feature | Typed client inference, invalid payloads, explicit DTOs and generated OpenAPI pass; RPC and REST adapters enforce identical tenant/access/concurrency rules |
| Biome, Commitlint, Lefthook, Knip | F / 1 | Local hooks and CI enforce formatting/lint and commit conventions; Knip understands workspace/framework/story/test entry points and rejects unexplained unused code/dependencies |
| Vitest, Playwright, GitHub Actions | F / 1 harness; F / 2–4 feature coverage | Unit/integration and browser suites execute through Bun scripts in required CI jobs; reports and production/Storybook builds gate merges |
| T3 Env, LogTape, AGENTS.md | F / 1 | Invalid runtime environment fails before work starts; client configuration excludes secrets; correlated logs are redacted; AI context documents the actual stack, commands and boundaries |
| Stripe | C / 5 | Checkout, portal, billing lifecycle, signature verification and replay/reconciliation tests pass; Foundation remains usable without billing credentials |

### Capability-to-phase and acceptance matrix

This matrix is the canonical acceptance register for the cross-cutting requirements below. Stable `R-*` IDs identify requirements; backlog IDs identify implementation work. Phase rows schedule these requirements, and the release checklist records evidence against the same IDs instead of restating their test cases. F/C/E labels describe when behavior is usable; later UI/provider integration does not postpone earlier enforcement. Phase 0 prototypes settle contracts; shipping acceptance runs on implemented services. Commercial module acceptance includes the Phase 6 recovery suite even if billing is implemented in Phase 5.

Protocol ownership is explicit: [architecture §2.6](02-architecture-and-security.md#26-relationship-based-authorization) owns authorization, [data model §3.3](03-data-model.md#canonical-lifecycle-lock-order) owns lock ordering, and [operations §4.8](04-billing-usage-operations.md#recovery-readiness-protocol) owns deletion/recovery. Other documents link to these procedures.

| ID | Capability | First implementation | Acceptance evidence | Later extension |
| --- | --- | --- | --- | --- |
| `R-IMAGE` | Docker image build and command packaging | F / 1 image; F / 2 real authorization commands | [Image acceptance](07-ci-and-docker-image.md#74-image-acceptance): reproducible build, assets, health, process failure, shutdown, packaged commands; Phase 2 verifies initialization retry and restored-data rejection | Later feature suites against the built image |
| `R-TENANCY` | Tenant isolation and multiple memberships | F / 2 | Same user active in two organizations; duplicate membership in one refused; actual restricted roles, cross-tenant FK/RLS, missing context, pooled connections and multi-tab switching; every later module extends isolation coverage | Files/search/exports/jobs/API coverage as modules ship |
| `R-LIFECYCLE` | Shared lock order | F / 2 | [Canonical order](03-data-model.md#canonical-lifecycle-lock-order) exercised across invite, role, transfer, deprovisioning and freeze races; no user fence acquired after an organization lock | C / 6 account closure; E / 7 directory adapter |
| `R-AUTHZ` | Context, revocation and late-write isolation | Phase 0 prototype; F / 2 organization/team production protocol; F / 3 resources | [Architecture §2.6](02-architecture-and-security.md#26-relationship-based-authorization): abandoned/late grant cannot alter current access, expiry and FGA failure deny access, request-namespace/model boundaries hold and preflight inputs are revalidated; Phase 2 recovery/transfer implements real source-commit readiness | Agent-authored features; custom roles and application hardening |
| `R-AUTHZ-PERF` | Hot-tenant availability | Phase 0 gate; F / 3 real slice | Full [operations §4.7 workload and targets](04-billing-usage-operations.md#phase-0-authorization-decision-gate), including first-attempt failures, fence waits, create-to-readable and cleanup cost | C bulk jobs; E / 8 image verification |
| `R-POLICY` | Local entitlements and capacity | F / 2–3 | Real database enforcement, Project create/restore quota races, idempotency and disabled-provider preset; flags/permissions remain independent | C / 5 sold plans/windows; E / 7 contracts |
| `R-SEATS` | Membership seat admission | F / 2 | Shared transition boundary and race suite in [billing §4.2](04-billing-usage-operations.md#seats-upgrades-and-contracts), using `R-LIFECYCLE` | C / 5 provider downgrade; E / 7 real SCIM |
| `R-KEYS` | Service accounts/API keys | F / 3 | Scoped, expired, revoked, rotated, wrong-tenant and undeclared-principal cases | C / 6 customer UI; restored keys invalidated by `R-RECOVERY` |
| `R-OWNER` | Last-owner protection and security override | F / 2 | Voluntary last-owner change refused; security deactivation succeeds during FGA outage, enters recovery, verifies replacement authority and publishes before reopening | E / 7 real SCIM and operator UI |
| `R-PASSWORD` | Email/password registration, sign-in and reset | F / 2 | Verified registration without credential takeover, hashed credentials, generic/rate-limited requests, scanner-safe expiring single-use reset, lifecycle/epoch and concurrent reset/login checks, session revocation, MFA/TOTP/recovery-code continuation and passwordless compatibility | E / 7 SSO policies |
| `R-MAGIC` | Email magic links | F / 2 | Atomic single use, expiry, scanner confirmation, generic responses, safe redirects and policy/assurance tests | E / 7 SSO policies |
| `R-PASSKEY` | Passkeys | F / 2 | Enrollment/sign-in/revoke, challenge/origin/RP/assurance checks, multiple credentials, recovery and passwordless sensitive actions | E / 7 enforced enterprise policy |
| `R-TRANSFER` | Ownership transfer | F / 2 | Verified active recipient acceptance, expiry/cancel, same-tenant/version checks, seat/audit atomicity and deprovisioning races under `R-LIFECYCLE` | C / 6 multi-org closure/recovery receipts |
| `R-EMAIL` | Identity/security email | F / 2 | Verification/password-reset/passwordless-recovery/magic-link/invite/transfer/recovery delivery, retry and redaction | C / 6 full preferences/in-app/deletion notices |
| `R-WORKSPACES` | Retired Workspace feature | Retired | Superseded by Organization → Projects; removal requires preservation of Project data/direct grants, explicit inherited-access retirement or conversion policy, rejection of obsolete API fields/scopes, and a supported schema/model upgrade | Historical acceptance remains evidence of the predecessor only |
| `R-SKILLS` | Foundation AI agent skills | F / 4 | All ten [skills §5.7 tasks](05-ai-agent-skills.md#57-skill-evaluation-and-release-evidence), held-out repeat evaluations and deterministic checks; preserve customization/history without commercial credentials | Applicable C/E suites in §5.8 |
| `R-SEARCH` | Cross-resource search | C / 6 | [Operations §4.6](04-billing-usage-operations.md#search-and-resource-activity-commercial-core): registered types, safe snippets/counts, tenant/permission filtering, revocation/deletion and sparse results; Foundation Project list search remains F / 3 | Additional registered types |
| `R-ACTIVITY` | Resource activity feeds | C / 6 | [Operations §4.6](04-billing-usage-operations.md#search-and-resource-activity-commercial-core): detail feed, event replay/deduplication, pagination/order, current permission, redaction and retention; audit remains independent | Additional event types |
| `R-ANALYTICS` | Product analytics | C / 6 | [Operations §4.9](04-billing-usage-operations.md#49-product-analytics): report/cohort fixtures, attribution, authoritative preferences, redaction, bounded outages, deletion and restore suppression | Additional tested adapters/reports |
| `R-ACCOUNT` | Personal account deletion | C / 6 | [Operations §4.8](04-billing-usage-operations.md#personal-account-deletion-and-ownership-continuity-commercial-core): multi-org ownership, credentials, retry, tenant billing continuity and journal replay | E / 7 retention/SCIM |
| `R-FILES` | Files/import/export | C / 6 | Immutable finalization and overwrite/replay/capacity races; current authorization on import/export/download; retention/expiry | Further formats/providers |
| `R-ORG-DATA` | Organization export/deletion | C / 6 | Journal acknowledgement, cancellation/replay, provider settlement and scoped export per [operations §4.8](04-billing-usage-operations.md#organization-deletion) | E / 7 retention/legal holds |
| `R-RECOVERY` | Recovery readiness and independent journal | Phase 0 design; C / 6 baseline | All [canonical recovery cases](04-billing-usage-operations.md#recovery-readiness-protocol), including post-backup ordinary revocations, credential replacement, independent revalidation and denied unverified organizations | E / 8 expanded recovery fault suite |

The skills' export/file and enterprise-identity suites are mandatory for presets that enable those modules, not prerequisites for the Foundation milestone. Foundation still rejects undeclared endpoints and unknown dependencies. No stub adapter or skipped required suite satisfies a milestone.

Optional Backoffice requirements use stable `R-BO-*` IDs in the [Backoffice acceptance register](#backoffice-acceptance-register) in this same roadmap. They extend applicable existing requirements, including `R-IMAGE`, and never reinterpret historical evidence. Backoffice is not added retroactively to the historically delivered Phase 0–4 scope; outstanding Foundation gates remain open.

## 6.3 Initial implementation backlog

| ID | Work item | Acceptance evidence |
| --- | --- | --- |
| ARCH-01 | Record stack/version matrix and image ADR | Supported versions, licenses, build inputs and combined-image packaging contract documented |
| SEC-01 | Threat-model browser/API/worker/provider boundaries | Tenant forgery, confused-deputy, stale-grant, secret exposure, and billing replay scenarios mapped to controls/tests |
| DB-01 | Prove PostgreSQL tenant context and membership constraints | `R-TENANCY`; exercise both membership indexes using the real restricted role |
| AUTH-01 | Prove identity-to-membership mapping and sole-owner recovery | `R-OWNER` and `R-TRANSFER`; Phase 0 adapter evidence, then real Phase 2 services |
| AUTHZ-01 | Prototype generation-isolated projection/publication | Phase 0 `R-AUTHZ` fault evidence |
| AUTHZ-02 | Run hot-tenant decision benchmark | Phase 0 `R-AUTHZ-PERF`; rerun on the Phase 3 slice |
| AUTHZ-03 | Implement the selected production authorization primitives in Phase 2 | `R-AUTHZ`, `R-LIFECYCLE` and Phase 2 `R-IMAGE`; required before transfer/recovery acceptance |
| REC-01 | Design and implement independent recovery controls | Phase 0 `R-RECOVERY` application protocol design; full baseline drill in Phase 6 |
| FILE-01 | Prove immutable finalization adapter | Phase 0 feasibility; complete `R-FILES` in Phase 6 |
| DEV-01 | Create Bun/Turborepo monorepo, T3 Env/Zod config, local dependencies and AGENTS.md | Pinned Bun and committed lockfile reproduce setup; invalid runtime config fails early; fresh clone can start services without production credentials; agent context matches commands |
| DEV-02 | Build GitHub Actions CI with Vitest/Playwright and two-organization synthetic fixtures | Repeatable integration environment; Biome/TypeScript/Commitlint/Knip, applicable security/integration/browser suites, fresh/upgrade migrations, Storybook and production builds gate merges |
| DEV-03 | Implement combined `app` Docker target | Non-root image supervises web/worker; packaged command modes work; build metadata and scans map to the tested commit |
| DEV-04 | Configure Biome, Commitlint, Lefthook and Knip | pre-commit and commit-msg hooks invoke shared policies; CI rejects formatting/lint/commit violations and unexplained unused code/dependencies even when local hooks are skipped |
| DEV-05 | Configure LogTape logging and redaction with OpenTelemetry correlation | Web/worker request, job and trace references correlate; credentials, authentication URLs and sensitive payloads are excluded from output |
| APP-01 | Implement initialization and model commands | Phase 2 `R-IMAGE`: resumable model/epoch bootstrap, existing/restored-data rejection and application readiness |
| UI-01 | Build React 19/Next.js shell with shadcn/ui, Tailwind CSS, next-intl, React Hook Form/Zod and Storybook | Responsive keyboard-accessible shell; locale/theme/form-state stories build; tenant change clears relevant state |
| TEN-01 | Implement organization/member/invitation lifecycle | `R-TENANCY`, `R-LIFECYCLE`, `R-SEATS` and `R-OWNER` in Phase 2 |
| QUOTA-01 | Implement local typed policies and transactional capacity | `R-POLICY` in Phases 2–3 |
| API-01 | Implement oRPC contracts/procedures, typed client, OpenAPI and context/error/DTO/idempotency/service-principal boundary | Runtime Zod validation and TypeScript client checks pass; RPC and REST calls cannot bypass checks; expiring/scoped/revoked keys and explicit principal capabilities tested by Phase 3 |
| DOMAIN-01 | Build Project vertical slice by hand | Mutation, generation readiness, audit/outbox, quotas, conflict, list UI and measured create-to-readable behavior pass together |
| SKILL-01 | Extract six skills and references from the proven slice | `R-SKILLS`; record applicable requirement IDs with evaluation evidence |
| AUTH-02 | Implement email magic links in Phase 2 | `R-MAGIC` and applicable `R-EMAIL` cases |
| AUTH-03 | Implement passkeys in Phase 2 | `R-PASSKEY` |
| AUTH-04 | Implement email/password registration, sign-in and reset in Phase 2 | `R-PASSWORD`, MFA/recovery continuation and applicable `R-EMAIL` cases |
| TEN-02 | Implement ownership transfer and lifecycle fences in Phase 2 | `R-TRANSFER` and `R-LIFECYCLE`; depends on production authorization work `AUTHZ-03` |
| ACC-01 | Implement personal account deletion in Phase 6 | `R-ACCOUNT`, `R-LIFECYCLE` and `R-RECOVERY` |
| ANALYTICS-01 | Implement product analytics in Phase 6 | `R-ANALYTICS`; one authoritative preference service |
| WORKSPACE-01 | Retired by Organization → Projects; retain predecessor history | `R-WORKSPACES` (retired) |
| SEARCH-01 | Implement cross-resource search in Phase 6 | `R-SEARCH`; reuses the Foundation list/field boundary |
| ACTIVITY-01 | Implement resource activity feeds in Phase 6 | `R-ACTIVITY` |

Implement security primitives before extracting agent skills. Add optional UI controls only after their server behavior exists. Do not ship visible placeholder enterprise settings that imply working protection.

## 6.4 Release checklist

Attach evidence for each applicable requirement ID in the [acceptance matrix](#capability-to-phase-and-acceptance-matrix), recording template commit, enabled preset/modules, image identity, suite version and result. The matrix and linked contracts own the test cases; this checklist owns release sign-off. An optional disabled module is explicitly out of scope, never reported as a passed test. All F/C/E requirements due by the selected milestone must pass.

### M1 Foundation sign-off 2026-09-27

The [Foundation record](foundation/acceptance.md) and its versioned evidence indexes accept the implemented Foundation preset through Phase 4. All requirements due for M1 pass:

- [x] Required stack, frozen install, source/types/unused-code checks, commit conventions, production and Storybook builds, and all eight hosted CI jobs.
- [x] `R-TENANCY`, `R-LIFECYCLE`, `R-AUTHZ`, `R-PASSWORD`, `R-MAGIC`, `R-PASSKEY`, `R-EMAIL`, `R-OWNER`, `R-TRANSFER` and `R-KEYS` on the enabled Foundation paths.
- [x] `R-POLICY` and `R-SEATS` with real local policy/capacity; billing remains disabled. Direct-Organization Projects preserve data/grants/history and retire `R-WORKSPACES` explicitly.
- [x] Phase 0 decision and Phase 3 real-feature `R-AUTHZ-PERF`, with unchanged production behavior and an explicit source-delta audit for test-only cleanup changes.
- [x] Current `R-IMAGE`, exact-image and dependency vulnerability policies, runtime configuration, logs/redaction, synthetic setup and packaged commands.
- [x] Foundation dashboard/browser behavior and `R-SKILLS`: six canonical skills, all ten tasks in both refreshed trials, independent security reviews, real migrations, customization preservation and source-identical repeats.

The general checklist below remains for later milestone scope. Unchecked combined items include Commercial/Enterprise behavior, released-product upgrades and the Phase 8 sustained-image gate; they are not outstanding M1 requirements. Backoffice is not enabled.

### Security and identity

- [ ] `R-TENANCY`, `R-LIFECYCLE` and `R-AUTHZ` pass for every enabled transport/module, including list/read/write/count/search/file/export/job paths as applicable.
- [ ] `R-PASSWORD`, `R-MAGIC`, `R-PASSKEY`, `R-EMAIL`, `R-OWNER`, `R-TRANSFER` and `R-KEYS` pass for the milestone; MFA/session controls and applicable SSO/SCIM policies are covered.
- [ ] Field restrictions, redaction, CSRF/origin/CORS, failed-action security recording and operator boundaries are verified.
- [x] Direct-Organization Projects pass removal, preservation, access-policy and schema/model-upgrade checks in the [removal brief](../feature-briefs/remove-workspaces.md); `R-WORKSPACES` is retired.

### Commercial correctness and data lifecycle

- [ ] `R-POLICY` and `R-SEATS` pass with the preset's actual entitlement/provider sources.
- [ ] Fixed/seat subscriptions cover creation, upgrades, downgrades, renewal, delinquency, cancellation, provider outage and reconciliation; duplicate/out-of-order/missed events converge.
- [ ] Usage deduplication, corrections, period boundaries, retry and financial reconciliation pass. Optional metered charging stays disabled until its separate adapter contract passes.
- [ ] Commercial modules pass `R-SEARCH`, `R-ACTIVITY`, `R-ANALYTICS`, `R-FILES`, `R-ACCOUNT` and `R-ORG-DATA` as applicable.
- [ ] `R-RECOVERY` passes for Commercial modules; Enterprise adds recovery fault scenarios with independent security revalidation.

### AI agent skills and developer experience

- [ ] All [required-stack delivery gates](#required-stack-delivery-gates) due for this milestone pass; versions and the Bun lockfile are reproducible, and CI enforces checks independently of local hooks.
- [ ] AGENTS.md documents actual commands/contracts; `R-SKILLS` evidence includes evaluated skill/reference/model versions, held-out repeat results and ordinary deterministic application CI.
- [ ] Applicable module evaluations from skills §5.8 pass, including preserved customization, history and feature evolution; no missing module or skipped required suite is counted as success.
- [ ] Renaming a product updates manifests, branding, packages, emails and example content; template upgrades have a tested previous-release migration/codemod path.

### Image verification and customer experience

- [ ] `R-IMAGE` passes for the selected milestone with retained build and verification evidence.
- [x] Phase 3 real-feature `R-AUTHZ-PERF` passes for `direct-project-v1`; see the [2026-09-27 acceptance record](phase3/acceptance.md#accepted-direct-project-performance-result).
- [ ] `R-AUTHZ-PERF` passes at its decision, real-feature and image verification gates; the documented workload also covers enabled bulk operations and tenant fairness.
- [ ] Synthetic local setup, safe runtime configuration, logs/traces/redaction, dead-letter diagnostics and reconciliation commands are usable.
- [ ] Dashboard forms/tables/dialogs meet keyboard/accessibility requirements and expose all required loading, pending, denied, conflict, quota and failure states.

### Phase 5 sign-off — 2026-10-19

The [Phase 5 acceptance record](phase5/acceptance.md) registers current evidence for
immutable plans, fixed/seat Stripe billing, hosted sessions, durable verified inbox and
commands, commercial policy/seats, transactional usage, localized UI and mandatory notices.
The new migration preserves the populated 0009 predecessor. Stripe remains opt-in and
Foundation policy remains credential-free. Independent skill behavior evaluations passed
on their recorded baseline, and the final-source Endive hosted Checkout/webhook repeat
passed all 11 checks. **Phase 5 is completed and accepted for its documented scope.**
[Hosted CI run 39271661736](https://github.com/dani-beltran/saas-cook/actions/runs/39271661736)
passed all nine jobs, including the final `required` gate and current dependency/image
security scans with zero blocking findings and no exceptions. The earlier failed local
database download is historical evidence, not an outstanding gate. No Phase 5 technical
gate remains before starting Phase 6; PR review/merge is a separate delivery step.
The renewed 30-minute authorization benchmark passed 442,464/442,464 operations on unchanged
Phase 5 source, with zero retries and every original latency target met.
Historical M1 evidence does not accept changed Phase 5 paths. M2 Commercial still requires
all due Phase 6 capabilities and recovery gates. Provider-metered charging and Backoffice
remain disabled/out of scope.

## 6.5 Configuration and adoption decisions

These defaults guide implementation, subject to the mandatory Phase 0 authorization, identity, storage, and recovery design gates. Product-specific choices below remain configurable; no default waives an acceptance gate.

| Topic | Template default | Product-specific decision |
| --- | --- | --- |
| Naming | `saas-cook` | Name/branding/package namespace for each bootstrapped product |
| Tenant/billing boundary | One organization, one billing account | Consolidated billing across several organizations? |
| Content administration | Org admins manage all tenant content | Need private content hidden even from tenant administrators? |
| Guests | Explicit limited membership, disabled until E | Are guests billable and how long may grants last? |
| Authentication | Better Auth with email/password, email magic links and passkeys; application-owned organization/account lifecycle | Canonical origin/RP ID, recovery and assurance policy, identity vendor/SSO licensing, supported IdPs |
| Product analytics | Typed catalogue and PostHog reference adapter; collection disabled until configured | Provider/residency, tracking controls, retention, report definitions and operator access |
| Account deletion | All-org ownership resolution, global freeze, independent journal and resumable cleanup | Deletion grace, retained categories, personal export and notification/status channels |
| Agent skills | Repository-local portable instructions with deterministic checks and isolated evaluations | Supported agent/model configuration, discovery adapters and evaluation repeat set |
| Owner recovery | Security deprovisioning revokes sole-owner access; verified recovery command | Application evidence and approval policy |
| Pricing | Versioned free/trial/fixed/seat definitions | Price amounts, currencies, trial rules, seat classes, grace duration |
| Metered charges | Disabled; local ledger/quotas included | Provider, metric contracts, allowed overages, credits, hybrid charge ownership |
| Retention | Configurable by data class | Required audit/financial retention, deletion grace, contractual holds |
| Recovery adapter | Journal/epoch/readiness/evidence; restored state requires credential replacement and access revalidation under `R-RECOVERY` | Application adapter implementation and supported replay horizon |
| File finalization | Private staging plus immutable approved object identity | Adapter create-once/version guarantees and download revocation window |
| Legal/compliance | Controls, evidence, and configuration hooks | Required agreements, certifications, regional obligations |

## 6.6 Risks and mitigation

| Risk | Mitigation and decision gate |
| --- | --- |
| Excessive scope makes the template hard to adopt | Modular presets; demonstrate F before C/E; optional extensions remain removable |
| A late projector request restores an obsolete grant | Unique immutable generations per attempt, conditional publication, recovery epoch, and the exact lost-lock/late-write fault test; Phase 0 proves the protocol |
| Graph copies/fences make ordinary tenant traffic unavailable | Mandatory Phase 0 hot-tenant budgets including creates, sparse lists and first-attempt failures; redesign and re-estimate before Phase 2 if the candidate fails |
| Restore counters look current while security or deletion history is obsolete | `R-RECOVERY`: independent replay, credential replacement, access revalidation and fresh graphs; ordinary post-backup revocations are explicit test cases |
| Sole-owner protection prevents security offboarding | Security deactivation overrides voluntary owner-count protection; freeze tenant activity and use verified audited recovery |
| Mutable upload changes after scan approval | Capture immutable bytes before scanning; bind download to the approved identity; overwrite/finalization race tests |
| Membership paths bypass seat accounting | One atomic transition/admission service shared by user, operator, directory and recovery commands; cross-entry-point races and provider reconciliation |
| Skill milestone depends on later commercial modules | Local policy/quota/key primitives in F / 2–3; explicit foundation/module acceptance split and capability matrix |
| Identity plugin and application membership disagree | One documented source of truth; mapping/deprovisioning spike before organization implementation |
| Billing replay or ambiguous state creates bad access/charges | Durable commands/inbox, idempotency, serialized projection, independent reconciliation |
| Agent edits destroy customization or history | Inspect current code/diff, preserve ordinary source and applied migrations, review compatibility, run evolution/resume tests |
| Skill instructions appear to guarantee correctness | Held-out behavioral evaluations and deterministic CI on real services; no text-equality or universal reliability claims |
| Account deletion or late analytics writes revive removed access/data | Global lifecycle fences, independent account/transfer journal, provider suppression/deletion barriers and restore/replay tests |
| Shared database introduces noisy tenants | Tenant fairness, query/index budgets, separate worker pools, measured path to dedicated placement |
| Optional provider costs undermine a reusable template | Local fakes, adapters, optional modules, verified vendor terms; record operational cost categories |
| Agent-authored features look complete but miss security | Required integration/security acceptance tests; no bypassable transport-only checks |

## 6.7 Backoffice planned delivery and acceptance

The [product brief](../feature-briefs/backoffice.md), [architecture/source inventory](backoffice/architecture.md) and [development plan](backoffice/development-plan.md) define a separate optional `apps/backoffice` with its own hostname, staff identity/session boundary, restricted network, credentials, build/start/deploy/version and `saas-cook-backoffice` image. The default customer `saas-cook` image retains its combined web/worker contract. This section schedules the planned extension to the existing single-application-image documentation; it does not claim that extension is implemented.

Recommendation: reuse reviewed domain services and initially the application database with separate operator schemas/roles, preserving the independent recovery/control store. Customer operation has no synchronous Backoffice dependency. Customer organization roles never grant operator authority; no generic superuser, fabricated customer session, migration role or BYPASSRLS solution is permitted. Existing signed recovery/deactivation authority remains independent.

### Backoffice phases and release scope

Every row is **planned/not started**. Effort is incremental to shared domain services, with full assumptions and overlap accounting in the [plan](backoffice/development-plan.md#effort-critical-path-and-parallel-delivery). These estimates do not amend or double-count the historical phase totals.

| Phase / objective | Relationship and prerequisites | Required exit gates | Incremental engineer-weeks |
| --- | --- | --- | --- |
| BO-00: architecture and prerequisite decisions | Design may proceed now; current Foundation/performance evidence required before production-capable BO-01 track; no extension of Phase 4 exception | `R-BO-ARCH`; BO-00.2 separately closes existing applicable prerequisites | 1–2, remediation excluded |
| BO-01: independent app/image, operator identity, network and audit | Minimal Phase 7 operator boundary pulled forward after Foundation prerequisites | `R-BO-ACCESS`, `R-BO-NETWORK`, `R-BO-AUDIT`, `R-BO-IMAGE`, initial `R-BO-COMPAT` | 5–8 |
| BO-02: masked read-only organization/account administration | BO-01; existing Foundation domain services; no billing provider required | `R-BO-DIRECTORY` plus extended access/audit/image evidence; earliest useful internal release | 3–5 |
| BO-03: controlled lifecycle, recovery cases and safe operational commands | BO-02; Phase 2 invariants; new minimal suspension/account services explicitly delivered as Phase 6/7 precursors | `R-BO-LIFECYCLE`, applicable `R-BO-OPS`; `R-LIFECYCLE`, `R-SEATS`, `R-OWNER`, `R-AUTHZ` remain mandatory | 4–7 |
| BO-04: finance operations and dunning | BO-02 and BO-03 command contract; Phase 5 actual provider/ledger services; bounded override service pulled forward from Phase 7 | `R-BO-BILLING`, `R-BO-DUNNING`; Phase 5 commercial and current seat/policy gates | 4–7, Phase 5 base excluded |
| BO-05: privacy exports/deletion/recovery | BO-03 and Phase 6 actual file/lifecycle/journal/recovery; hold checks required before purge | `R-BO-PRIVACY` plus `R-FILES`, `R-ACCOUNT`, `R-ORG-DATA`, `R-RECOVERY` | 5–9, Phase 6 base excluded |
| BO-06: flags/messages/help desk and operations tooling | BO-02/03 commands; Phase 6 shared evaluator, notifications/preferences and integration services; may run alongside BO-04/05 | `R-BO-FLAGS`, `R-BO-MESSAGING`, `R-BO-HELPDESK`, `R-BO-OPS` per enabled module | 5–9, shared Phase 6 base excluded |
| BO-07: reporting, enterprise access and release hardening | Confirmed Phase 5 facts; relevant Phase 6 events/lifecycle; Phases 7/8 governance/compatibility/performance | `R-BO-REPORTING`, final `R-BO-COMPAT`, `R-BO-RELEASE` and all applicable existing gates | 4–7; selected SSO +2–4 if not otherwise delivered |
| BO-X01: delegated support access | Optional, excluded by default; separate justification and policy/model design after supported operator workflows prove insufficient | `R-BO-SUPPORT` before any enablement | Separate estimate after scope decision |

Initial internal release is BO-00–02, not monetization or Enterprise acceptance. Base Backoffice estimate is 31–54 incremental engineer-weeks; initial release 9–15, with unresolved Foundation remediation and shared Phase 5–8 service work excluded. Existing M1/M2/M3 definitions and pending gates remain unchanged. Optional Backoffice does not block a customer-only milestone; an enabled Backoffice must pass every gate due for its declared release scope. Missing services remain unavailable, not represented by a permissive adapter or a visible placeholder that suggests working protection.

### Backoffice acceptance register

**All new gates below are planned / pending, with no implementation evidence yet.** This is the canonical sign-off table. The [requirement traceability](backoffice/development-plan.md#requirement-traceability) maps the complete product request to stable work IDs and these gates. On acceptance, append scoped evidence links, source/image fingerprints and limitations here; preserve historical results instead of overwriting them.

| Stable ID | First due | Required measurable acceptance / failure evidence |
| --- | --- | --- |
| `R-BO-ARCH` | BO-00 | Source/migration/config/CI/image inventory, proposed ADRs and diagrams reviewed; complete requirement→work→gate mapping; shared-service ownership, field/role/retention matrices and exact existing-contract amendments; all material unknowns have owners and release-blocking conditions |
| `R-BO-ACCESS` | BO-01, extended for each action | Separate invited staff identity, MFA/step-up/current scope/session/epoch and operator-model evidence against real DB/FGA; customer roles/cookies/keys denied; self-grant/self-approval, role revocation, late response, lost connection and transaction-wide expiry tests; selected SSO/offboarding proved before enablement |
| `R-BO-NETWORK` | BO-01 | Private-origin bypass blocked; actual ingress proof/known proxies and IPv4/IPv6 CIDR cases; forged/ambiguous forwarding headers fail; MFA remains required inside network; dual-controlled change and independently audited lockout/emergency drill |
| `R-BO-AUDIT` | BO-01 onward | Sensitive read/search/reveal/export/download, mutations, approvals and denials record actual operator/effective/workload actor as applicable, scope/reason/outcome/correlation with allowlisted changes; audit failure prevents disclosure/mutation; separate denial transaction survives rollback; append-only grants and restricted retention/export tested |
| `R-BO-IMAGE` | BO-01/02, each shipped image change | Separate credential-free build/standalone assets/non-root/native runtime/config/health/signals and distinct images; customer HTTP/routes/browser bundles exclude operator surface; no cross-app runtime secrets; customer sign-in, CRUD/capacity and mail work with BO stopped/omitted/blackholed; both exact images scanned and provenance/evidence retained under existing `R-IMAGE` policy |
| `R-BO-DIRECTORY` | BO-02 | Bounded scoped masked org/global-account/membership directory and details; platform identity distinct from business records; actor/query/scope-bound cursors, separate reveal/export grants, overlapping-account and field leakage cases; stale/suppressed projections deny unsafe disclosure; ratified query/load limits measured |
| `R-BO-LIFECYCLE` | BO-03 | Complete request/preview/authorize/approve/execute/reconcile/status workflow; cause-specific suspend/reactivate and exact session revocation; stale targets/approval/replay and concurrent admission/freeze tests preserve seats/locks/audit/outbox/expiry; signed recovery remains independently approved, fresh-MFA and cannot clear global restore readiness |
| `R-BO-BILLING` | BO-04 | Real Phase 5 services plus selected adapter sandbox proof for plans/trials/invoices/payments/usage/adjustments; preview/effective/proration/expiry/limits and dual approval; provider truth, sold versions, entitlements and contracts distinct; races/replay/out-of-order/ambiguous submissions reconcile with no duplicate semantic charge or unconfirmed access grant |
| `R-BO-DUNNING` | BO-04 | Delinquency episodes/failed-payment history/reminder ownership/retry/grace/escalation visible; provider is sole collection retry scheduler; duplicate events/notices, provider outage and payment-versus-grace races converge; recovery reporting uses confirmed receipts |
| `R-BO-PRIVACY` | BO-05 | Verified scoped intake/assignment/policy clocks/evidence; distinct org/subject export with redaction/encryption/expiry/current download audit; exact deletion preview/approval/hold/cancel/multi-org ownership and resumable cleanup; every enabled store/provider included; journal/recovery gates pass; provider-pending, retained categories and backup expiry reported honestly |
| `R-BO-FLAGS` | BO-06 | Deterministic environment/org/segment percentage evaluation with ownership/history/schedule/expiry/rollback; measured healthy propagation/cache defaults and independent emergency off; BO outage safe; flags cannot bypass authorization or entitlements |
| `R-BO-MESSAGING` | BO-06 | Typed safe rendering and links; draft/preview/review/localization/scheduling/preferences/dismissal/frequency/expiry/rollback; actual customer query/render changes tested; injection, duplicate/preference/target-scope and BO outage cases pass; no arbitrary operator HTML/JS |
| `R-BO-HELPDESK` | BO-06 | Selected tested adapter provides verified tenant/user mapping, safe deep links and bounded ticket summary; minimum credentials, raw-body signature/replay cases if webhook enabled, rate-limit/outage/freshness and provider deletion/suppression evidence; synthetic and provider sandbox proof |
| `R-BO-OPS` | BO-03 initial, BO-06 complete | Redacted job/outbox/inbox/mail status and dead-letter detail; consumer-specific replay/reconciliation and scoped incident controls; fixed capped bulk manifest/current per-item scope/version, fairness, stop/partial outcome; duplicate effects, arbitrary commands and payload editing denied |
| `R-BO-REPORTING` | BO-07 | Versioned MRR/ARR/churn/expansion/contraction/retention/trial/recovery formulas and cohorts reconcile to authoritative fixtures; annual/discount/refund/currency/FX and zero-denominator cases; CAC/LTV inputs absent show unavailable or explicit estimate; measured bounded query/projection freshness without breaking customer budgets |
| `R-BO-COMPAT` | BO-01 initial, BO-07 final | Explicit schema/model/event/command/API compatibility manifest; actual supported old/new app pairs, migration owner and independent rollback; unknown versions fail before effects; breaking tenant-model upgrades retain maintenance contract; BO-only failures/upgrades never clear or unnecessarily close customer readiness |
| `R-BO-RELEASE` | BO-07 | All enabled BO and existing Phase 5–8 gates accepted on stable source and exact images; concurrent customer/operator/export load preserves original targets; recovery/accessibility/threat review, scans/provenance and retained failures; no claim that an unavailable optional adapter, historical benchmark or legal framework is verified |
| `R-BO-SUPPORT` | Optional BO-X01 only | Independent scope justification, consent/approval and typed delegated principal/model; actual operator always audited, visible access, short expiry/revocation/current permission; no fabricated customer session and no default billing/security/export/delete powers; denial and outage tests before enablement |

New evidence must extend, rather than replace, `R-TENANCY`, `R-LIFECYCLE`, `R-AUTHZ`, `R-SEATS`, `R-POLICY`, `R-OWNER`, `R-IMAGE` and applicable privacy/recovery gates. Phase 3's real-feature `R-AUTHZ-PERF` passed for the active direct-Project design in the [2026-09-27 run](phase3/acceptance.md#accepted-direct-project-performance-result); changed workloads and later image verification need their own evidence. No earlier security/performance exception automatically applies to a new image, operator action or provider module.
