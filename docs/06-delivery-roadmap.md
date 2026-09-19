# 6. Delivery roadmap

## 6.1 Delivery strategy

Build a working vertical slice before expanding the catalogue. Prove identity, tenant isolation, resource permissions, a real database transaction, a dashboard operation, audit, and asynchronous delivery together. Implement provider-independent entitlement/capacity and service-principal primitives before the reference feature's acceptance suite. Extract AI agent skills from the proven slice after authorization safety and availability gates pass, then use them for subsequent modules. Validate resulting code with deterministic tools and evaluate skill behavior separately.

All phases below are planned. Completion requires demonstrated acceptance criteria; a stub adapter, hidden navigation item, or documentation entry is not an implemented capability.

## 6.2 Phases and acceptance gates

| Phase | Deliverables | Depends on | Exit gate | Effort estimate |
| --- | --- | --- | --- | --- |
| 0. Validate decisions | Threat model; required-stack dependency/license/version matrix, including React 19 and Bun workspace compatibility; oRPC/Zod/Next.js adapter spike; magic-link/passkey assurance and ownership/account-lifecycle race spike; RLS/pool spike; generation-isolated OpenFGA prototype; hot-tenant benchmark; independent recovery-store design; billing/storage/analytics adapter feasibility; Docker host/registry/tool versions and CI identity/network ADR | This plan | Required technologies have compatible versions and mappings; late-write fault suite and healthy availability budgets pass; recovery ownership, immutable-object contract, and deployment ownership recorded in ADRs | 3–5 engineer-weeks |
| 1. Repository and runtime | Bun/Turborepo; Next.js/React 19/TypeScript/shadcn/ui/Tailwind shell; next-intl/forms/Storybook patterns; worker; local services; T3 Env; oRPC skeleton; GitHub Actions and quality toolchain; AGENTS.md; combined application image and GHCR; Docker staging, install/upgrade scripts and independent installation/readiness records; LogTape/OpenTelemetry; test fixtures | 0 | Required-stack gates and infrastructure portion of `R-DEPLOY` pass with synthetic data | 2–4 |
| 2. Identity, tenancy and authorization primitives | Better Auth/MFA/sessions, magic links, passkeys and identity emails; organizations/members/invitations/teams and ownership transfer; tenant context/RLS, audit/outbox, local policy/seat admission; selected production graph protocol for organization/team roles, lifecycle/authorization fences, independent epoch/readiness and fresh model bootstrap; owner-recovery command/runbook and account/org UI | 1 | `R-TENANCY`, `R-LIFECYCLE`, `R-AUTHZ`, `R-SEATS`, `R-OWNER`, `R-MAGIC`, `R-PASSKEY`, `R-TRANSFER`, `R-EMAIL` and Phase 2 `R-DEPLOY` pass against real services; recovery/transfer complete graph publication | 5–8 |
| 3. Resource authorization and reference feature | Extend the Phase 2 protocol to Project/workspace resources; optional workspace CRUD/archive and inherited access; service-account/API-key enforcement/provisioning; generic capacity reservations; Project CRUD and feature-local search/pagination; oRPC/Zod contracts, typed client, public OpenAPI and concurrency | 2 | `R-WORKSPACES`, `R-KEYS`, `R-POLICY` and real-feature `R-AUTHZ`/`R-AUTHZ-PERF` pass; both API transports use the same policy and concurrency boundary | 4–6 |
| 4. AI agent skills | Bootstrap/add/evolve/verify feature skills, dashboard/email skills, feature briefs, shared references, discovery adapters and isolated behavior evaluations; deterministic migration/RLS/API checks | 3 | Agent implements Project + child Task and service-account variant; held-out behavior suites pass without commercial credentials; evolution/resume preserves custom code/data/history; repeated requests add no duplicate artifacts | 3–5 |
| 5. Monetization | Plans, Stripe fixed/seat billing, Checkout and Customer Portal, webhook inbox, commercial entitlement sources, ledger/windowed quotas, usage dashboard, reconciliation and notices | 4 | Stripe lifecycle and replay/out-of-order tests pass; provider downgrades and admission races converge; no duplicate semantic charge or usage | 4–6 |
| 6. Platform modules and baseline recovery | Files/import/export; cross-resource search and resource activity feeds; personal/organization deletion and independent journal; analytics events/reports/controls/cleanup; recovery with credential replacement and independent access revalidation; notifications/API-key UI/webhooks/integrations/flags; audit/help/public UI and production promotion | 5 | `R-SEARCH`, `R-ACTIVITY`, `R-ANALYTICS`, `R-ACCOUNT`, `R-FILES`, `R-ORG-DATA`, `R-RECOVERY` and Commercial `R-DEPLOY` pass before customer data | 6–9 |
| 7. Enterprise administration | OIDC/SAML, SCIM, custom roles, security policies, guests, contract overrides, operator/support UI, advanced retention/legal-hold hooks | 6 | Real IdP deprovisioning is organization-scoped, including sole owner; SCIM uses shared seat admission; recovery/support/policy actions fully audited | 4–7 |
| 8. Hardening and template release | Expanded performance/failure/recovery drills, measured RPO/RTO, accessibility, upgrade rehearsal, deployment/runbooks, bootstrap presets, release provenance | 7 | All applicable release gates pass on reference deployment; tagged template release with documented limitations | 3–5 |

Revised indicative total: **34–55 engineer-weeks** for the enterprise baseline, including passwordless identity, account lifecycle/ownership transfer, product analytics, agent-skill evaluation, the authorization prototype, direct Docker delivery, and baseline recovery. The Phase 2/3 estimates move 1–2 engineer-weeks of authorization primitives into Phase 2; this is a sequencing correction, not a scope reduction. The newly explicit workspace/search/activity gates cover existing catalogue promises. Validate their effort and the cost/time of recovery security revalidation in Phase 0; the current total remains provisional. Replacing the custom generator does not assume an unmeasured AI productivity gain. Phase 1 retains 1–2 engineer-weeks for combined-process packaging and delivery validation. Kubernetes remains additional scope. With two experienced full-stack engineers and part-time product/design/security/operations support, allow roughly **21–34 calendar weeks**. Re-estimate after Phase 0, Phase 3, and the first Phase 4 skill evaluations; failed architecture or recovery targets require revised estimates before implementation proceeds.

Milestones:

- **M1 Foundation:** Phases 0–4. Runnable foundation preset, reference domain, real local entitlements/capacity, service-principal enforcement, and evaluated agent skills; full commercial/export/account-deletion workflows are outside this milestone.
- **M2 Commercial core:** through Phase 6. A product can sell subscriptions and operate common SaaS workflows after demonstrating baseline backup/restore, personal account deletion/ownership continuity, organization export/deletion, analytics controls, and the applicable module suites.
- **M3 Enterprise baseline:** through Phase 8. Enterprise identity/governance and operational recovery have been demonstrated.

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

This matrix is the canonical acceptance register for the cross-cutting requirements below. Stable `R-*` IDs identify requirements; backlog IDs identify implementation work. Phase rows schedule these requirements, and the release checklist records evidence against the same IDs instead of restating their test cases. F/C/E labels describe when behavior is usable; later UI/provider integration does not postpone earlier enforcement. Phase 0 prototypes settle contracts; shipping acceptance runs on implemented services. Commercial customer data requires the Phase 6 recovery gate even if billing is available in Phase 5.

Protocol ownership is explicit: [architecture §2.6](02-architecture-and-security.md#26-relationship-based-authorization) owns authorization, [data model §3.3](03-data-model.md#canonical-lifecycle-lock-order) owns lock ordering, and [operations §4.8](04-billing-usage-operations.md#recovery-readiness-protocol) owns deletion/recovery. Other documents link to these procedures.

| ID | Capability | First implementation | Acceptance evidence | Later extension |
| --- | --- | --- | --- | --- |
| `R-DEPLOY` | CI/CD and Docker deployment | F / 1 infrastructure; F / 2 authorization bootstrap | [Deployment §7.5–7.8](07-ci-cd-and-deployment.md#fresh-install-initialization): explicit install/upgrade paths, initial store/model/epoch, interrupted retry and restored-data rejection; process/migration/readiness failures and compatible rollback; deployed feature suites in F / 3–4 | C / 6 production/recovery; E / 8 capacity/upgrade/provenance |
| `R-K8S` | Kubernetes/Helm | X / after Docker contract | Split images, fresh install/bootstrap, migration/model Jobs, rolling upgrade and compatible rollback on a reference cluster | Never required for Docker-only milestones |
| `R-TENANCY` | Tenant isolation and multiple memberships | F / 2 | Same user active in two organizations; duplicate membership in one refused; actual restricted roles, cross-tenant FK/RLS, missing context, pooled connections and multi-tab switching; every later module extends isolation coverage | Files/search/exports/jobs/API coverage as modules ship |
| `R-LIFECYCLE` | Shared lock order | F / 2 | [Canonical order](03-data-model.md#canonical-lifecycle-lock-order) exercised across invite, role, transfer, deprovisioning and freeze races; no user fence acquired after an organization lock | C / 6 account closure; E / 7 directory adapter |
| `R-AUTHZ` | Projection and late-write isolation | Phase 0 prototype; F / 2 organization/team production protocol; F / 3 resources | [Architecture §2.6](02-architecture-and-security.md#26-relationship-based-authorization): abandoned/late grant cannot alter current access, expiry and FGA failure deny access, generation/model boundaries hold; Phase 2 recovery/transfer completes real publication | Agent-authored features; custom roles and deployment hardening |
| `R-AUTHZ-PERF` | Hot-tenant availability | Phase 0 gate; F / 3 real slice | Full [operations §4.7 workload and targets](04-billing-usage-operations.md#phase-0-authorization-decision-gate), including first-attempt failures, fence waits, create-to-readable and cleanup cost | C bulk jobs; E / 8 deployment |
| `R-POLICY` | Local entitlements and capacity | F / 2–3 | Real database enforcement, Project create/restore quota races, idempotency and disabled-provider preset; flags/permissions remain independent | C / 5 sold plans/windows; E / 7 contracts |
| `R-SEATS` | Membership seat admission | F / 2 | Shared transition boundary and race suite in [billing §4.2](04-billing-usage-operations.md#seats-upgrades-and-contracts), using `R-LIFECYCLE` | C / 5 provider downgrade; E / 7 real SCIM |
| `R-KEYS` | Service accounts/API keys | F / 3 | Scoped, expired, revoked, rotated, wrong-tenant and undeclared-principal cases | C / 6 customer UI; restored keys invalidated by `R-RECOVERY` |
| `R-OWNER` | Last-owner protection and security override | F / 2 | Voluntary last-owner change refused; security deactivation succeeds during FGA outage, enters recovery, verifies replacement authority and publishes before reopening | E / 7 real SCIM and operator UI |
| `R-MAGIC` | Email magic links | F / 2 | Atomic single use, expiry, scanner confirmation, generic responses, safe redirects and policy/assurance tests | E / 7 SSO policies |
| `R-PASSKEY` | Passkeys | F / 2 | Enrollment/sign-in/revoke, challenge/origin/RP/assurance checks, multiple credentials, recovery and passwordless sensitive actions | E / 7 enforced enterprise policy |
| `R-TRANSFER` | Ownership transfer | F / 2 | Verified active recipient acceptance, expiry/cancel, same-tenant/version checks, seat/audit atomicity and deprovisioning races under `R-LIFECYCLE` | C / 6 multi-org closure/recovery receipts |
| `R-EMAIL` | Identity/security email | F / 2 | Verification/reset/magic-link/invite/transfer/recovery delivery, retry and redaction | C / 6 full preferences/in-app/deletion notices |
| `R-WORKSPACES` | Optional Foundation workspaces | F / 3 | Create/rename/archive/list and attach/move Project; same-tenant parents, inherited allow/deny/revocation, source/destination authorization and disabled-module behavior; archived workspace refuses new assignments while existing resources retain documented access | Additional resource types reuse the contract |
| `R-SKILLS` | Foundation AI agent skills | F / 4 | All ten [skills §5.7 tasks](05-ai-agent-skills.md#57-skill-evaluation-and-release-evidence), held-out repeat evaluations and deterministic checks; preserve customization/history without commercial credentials | Applicable C/E suites in §5.8 |
| `R-SEARCH` | Cross-resource search | C / 6 | [Operations §4.6](04-billing-usage-operations.md#search-and-resource-activity-commercial-core): registered types, safe snippets/counts, tenant/permission filtering, revocation/deletion and sparse results; Foundation Project list search remains F / 3 | Additional registered types |
| `R-ACTIVITY` | Resource activity feeds | C / 6 | [Operations §4.6](04-billing-usage-operations.md#search-and-resource-activity-commercial-core): detail feed, event replay/deduplication, pagination/order, current permission, redaction and retention; audit remains independent | Additional event types |
| `R-ANALYTICS` | Product analytics | C / 6 | [Operations §4.9](04-billing-usage-operations.md#49-product-analytics): report/cohort fixtures, attribution, authoritative preferences, redaction, bounded outages, deletion and restore suppression | Additional tested adapters/reports |
| `R-ACCOUNT` | Personal account deletion | C / 6 | [Operations §4.8](04-billing-usage-operations.md#personal-account-deletion-and-ownership-continuity-commercial-core): multi-org ownership, credentials, retry, tenant billing continuity and journal replay | E / 7 retention/SCIM |
| `R-FILES` | Files/import/export | C / 6 | Immutable finalization and overwrite/replay/capacity races; current authorization on import/export/download; retention/expiry | Further formats/providers |
| `R-ORG-DATA` | Organization export/deletion | C / 6 | Journal acknowledgement, cancellation/replay, provider settlement and scoped export per [operations §4.8](04-billing-usage-operations.md#organization-deletion) | E / 7 retention/legal holds |
| `R-RECOVERY` | Recovery readiness and independent journal | Phase 0 design; C / 6 baseline | All [canonical recovery cases](04-billing-usage-operations.md#recovery-readiness-protocol), including post-backup ordinary revocations, credential replacement, independent revalidation and denied unverified organizations | E / 8 measured RPO/RTO including user revalidation |

The skills' export/file and enterprise-identity suites are mandatory for presets that enable those modules, not prerequisites for the Foundation milestone. Foundation still rejects undeclared endpoints and unknown dependencies. No stub adapter or skipped required suite satisfies a milestone.

## 6.3 Initial implementation backlog

| ID | Work item | Acceptance evidence |
| --- | --- | --- |
| ARCH-01 | Record stack/version matrix and deployment ADR | Supported versions, licenses, Docker host/registry provider, runner connectivity, deployment identity/trust, upgrade policy, and infrastructure ownership documented |
| SEC-01 | Threat-model browser/API/worker/provider boundaries | Tenant forgery, confused-deputy, stale-grant, secret exposure, and billing replay scenarios mapped to controls/tests |
| DB-01 | Prove PostgreSQL tenant context and membership constraints | `R-TENANCY`; exercise both membership indexes using the real restricted role |
| AUTH-01 | Prove identity-to-membership mapping and sole-owner recovery | `R-OWNER` and `R-TRANSFER`; Phase 0 adapter evidence, then real Phase 2 services |
| AUTHZ-01 | Prototype generation-isolated projection/publication | Phase 0 `R-AUTHZ` fault evidence |
| AUTHZ-02 | Run hot-tenant decision benchmark | Phase 0 `R-AUTHZ-PERF`; rerun on the Phase 3 slice |
| AUTHZ-03 | Implement the selected production authorization primitives in Phase 2 | `R-AUTHZ`, `R-LIFECYCLE` and Phase 2 `R-DEPLOY`; required before transfer/recovery acceptance |
| REC-01 | Design and implement independent recovery controls | Phase 0 `R-RECOVERY` design and revalidation/RTO feasibility; full baseline drill in Phase 6 |
| FILE-01 | Prove immutable finalization adapter | Phase 0 feasibility; complete `R-FILES` in Phase 6 |
| DEV-01 | Create Bun/Turborepo monorepo, T3 Env/Zod config, local dependencies and AGENTS.md | Pinned Bun and committed lockfile reproduce setup; invalid runtime config fails early; fresh clone can start services without production credentials; agent context matches commands |
| DEV-02 | Build GitHub Actions CI with Vitest/Playwright and two-organization synthetic fixtures | Repeatable integration environment; Biome/TypeScript/Commitlint/Knip, applicable security/integration/browser suites, fresh/upgrade migrations, Storybook and production builds gate merges |
| DEV-03 | Implement combined `app` Docker target and release publication | Non-root container supervises web/worker; one-off migration/publication modes work; GHCR digest, scans, SBOM/provenance and signatures map to the tested commit; PR jobs cannot publish |
| DEV-04 | Configure Biome, Commitlint, Lefthook and Knip | pre-commit and commit-msg hooks invoke shared policies; CI rejects formatting/lint/commit violations and unexplained unused code/dependencies even when local hooks are skipped |
| DEV-05 | Configure LogTape logging and redaction with OpenTelemetry correlation | Web/worker request, job and trace references correlate; credentials, authentication URLs and sensitive payloads are excluded from output |
| OPS-01 | Prepare Docker staging and host infrastructure | Phase 1 infrastructure portion of `R-DEPLOY` |
| OPS-02 | Implement install/bootstrap, upgrade, and promotion workflows | `R-DEPLOY`; Phase 1 installation bookkeeping, Phase 2 real model/epoch bootstrap, later deployed module suites |
| OPS-03 | Complete production delivery and operational handover in Phase 6 | Commercial `R-DEPLOY` and `R-RECOVERY`; production access, secret rotation and assigned runbook ownership |
| OPS-X01 | Optional Kubernetes adapter and Helm chart | `R-K8S`; outside the required baseline |
| UI-01 | Build React 19/Next.js shell with shadcn/ui, Tailwind CSS, next-intl, React Hook Form/Zod and Storybook | Responsive keyboard-accessible shell; locale/theme/form-state stories build; tenant change clears relevant state |
| TEN-01 | Implement organization/member/invitation lifecycle | `R-TENANCY`, `R-LIFECYCLE`, `R-SEATS` and `R-OWNER` in Phase 2 |
| QUOTA-01 | Implement local typed policies and transactional capacity | `R-POLICY` in Phases 2–3 |
| API-01 | Implement oRPC contracts/procedures, typed client, OpenAPI and context/error/DTO/idempotency/service-principal boundary | Runtime Zod validation and TypeScript client checks pass; RPC and REST calls cannot bypass checks; expiring/scoped/revoked keys and explicit principal capabilities tested by Phase 3 |
| DOMAIN-01 | Build Project vertical slice by hand | Mutation, generation readiness, audit/outbox, quotas, conflict, list UI and measured create-to-readable behavior pass together |
| SKILL-01 | Extract six skills and references from the proven slice | `R-SKILLS`; record applicable requirement IDs with evaluation evidence |
| AUTH-02 | Implement email magic links in Phase 2 | `R-MAGIC` and applicable `R-EMAIL` cases |
| AUTH-03 | Implement passkeys in Phase 2 | `R-PASSKEY` |
| TEN-02 | Implement ownership transfer and lifecycle fences in Phase 2 | `R-TRANSFER` and `R-LIFECYCLE`; depends on production authorization work `AUTHZ-03` |
| ACC-01 | Implement personal account deletion in Phase 6 | `R-ACCOUNT`, `R-LIFECYCLE` and `R-RECOVERY` |
| ANALYTICS-01 | Implement product analytics in Phase 6 | `R-ANALYTICS`; one authoritative preference service |
| WORKSPACE-01 | Implement optional workspaces in Phase 3 | `R-WORKSPACES` |
| SEARCH-01 | Implement cross-resource search in Phase 6 | `R-SEARCH`; reuses the Foundation list/field boundary |
| ACTIVITY-01 | Implement resource activity feeds in Phase 6 | `R-ACTIVITY` |

Implement security primitives before extracting agent skills. Add optional UI controls only after their server behavior exists. Do not ship visible placeholder enterprise settings that imply working protection.

## 6.4 Release checklist

Attach evidence for each applicable requirement ID in the [acceptance matrix](#capability-to-phase-and-acceptance-matrix), recording template commit, enabled preset/modules, deployment profile, suite version and result. The matrix and linked contracts own the test cases; this checklist owns release sign-off. An optional disabled module is explicitly out of scope, never reported as a passed test. All F/C/E requirements due by the selected milestone must pass.

### Security and identity

- [ ] `R-TENANCY`, `R-LIFECYCLE` and `R-AUTHZ` pass for every enabled transport/module, including list/read/write/count/search/file/export/job paths as applicable.
- [ ] `R-MAGIC`, `R-PASSKEY`, `R-EMAIL`, `R-OWNER`, `R-TRANSFER` and `R-KEYS` pass for the milestone; MFA/session controls and applicable SSO/SCIM policies are covered.
- [ ] Field restrictions, redaction, CSRF/origin/CORS, failed-action security recording and operator boundaries are verified.
- [ ] Foundation workspace implementation passes `R-WORKSPACES`; a product disabling it verifies the disabled-module case.

### Commercial correctness and data lifecycle

- [ ] `R-POLICY` and `R-SEATS` pass with the preset's actual entitlement/provider sources.
- [ ] Fixed/seat subscriptions cover creation, upgrades, downgrades, renewal, delinquency, cancellation, provider outage and reconciliation; duplicate/out-of-order/missed events converge.
- [ ] Usage deduplication, corrections, period boundaries, retry and financial reconciliation pass. Optional metered charging stays disabled until its separate adapter contract passes.
- [ ] Commercial modules pass `R-SEARCH`, `R-ACTIVITY`, `R-ANALYTICS`, `R-FILES`, `R-ACCOUNT` and `R-ORG-DATA` as applicable.
- [ ] `R-RECOVERY` passes before Commercial customer data; Enterprise evidence includes measured RPO/RTO and independent security revalidation time.

### AI agent skills and developer experience

- [ ] All [required-stack delivery gates](#required-stack-delivery-gates) due for this milestone pass; versions and the Bun lockfile are reproducible, and CI enforces checks independently of local hooks.
- [ ] AGENTS.md documents actual commands/contracts; `R-SKILLS` evidence includes evaluated skill/reference/model versions, held-out repeat results and ordinary deterministic application CI.
- [ ] Applicable module evaluations from skills §5.8 pass, including preserved customization, history and feature evolution; no missing module or skipped required suite is counted as success.
- [ ] Renaming a product updates manifests, branding, packages, emails and example content; template upgrades have a tested previous-release migration/codemod path.

### Operations and customer experience

- [ ] `R-DEPLOY` passes for the selected milestone with retained signed release/configuration evidence; `R-K8S` is additionally required only for that extension.
- [ ] `R-AUTHZ-PERF` passes at its decision, real-feature and release-deployment gates; the documented workload also covers enabled bulk operations and tenant fairness.
- [ ] Synthetic local setup, safe runtime configuration, logs/traces/redaction, alerts, dead-letter diagnostics and reconciliation runbooks are usable.
- [ ] Dashboard forms/tables/dialogs meet keyboard/accessibility requirements and expose all required loading, pending, denied, conflict, quota and failure states.
- [ ] Incident response, dependency updates, security contact, secret rotation, backup/revalidation, rollback/forward-fix ownership and recovery escalation contacts are assigned.

## 6.5 Configuration and adoption decisions

These defaults guide implementation, subject to the mandatory Phase 0 authorization, identity, storage, and recovery design gates. Product-specific choices below remain configurable; no default waives an acceptance gate.

| Topic | Template default | Product-specific decision |
| --- | --- | --- |
| Naming | `common-sass` | Name/branding/package namespace for each bootstrapped product |
| Tenant/billing boundary | One organization, one billing account | Consolidated billing across several organizations? |
| Content administration | Org admins manage all tenant content | Need private content hidden even from tenant administrators? |
| Guests | Explicit limited membership, disabled until E | Are guests billable and how long may grants last? |
| Hosting | One Docker application container on a host/VM with external PostgreSQL/OpenFGA/object storage; separate production host | Cloud/region, host provider, residency, maintenance interval, network controls; opt into Kubernetes + Helm if needed |
| CI/CD | GitHub Actions + BuildKit + GHCR; automatic staging, protected production promotion by digest | Registry, runner connectivity, OIDC provider, production reviewers, retention and vulnerability exceptions |
| Authentication | Better Auth with email magic links and passkeys; application-owned organization/account lifecycle | Canonical origin/RP ID, recovery and assurance policy, identity vendor/SSO licensing, supported IdPs |
| Product analytics | Typed catalogue and PostHog reference adapter; collection disabled until configured | Provider/residency, tracking controls, retention, report definitions and operator access |
| Account deletion | All-org ownership resolution, global freeze, independent journal and resumable cleanup | Deletion grace, retained categories, personal export and notification/status channels |
| Agent skills | Repository-local portable instructions with deterministic checks and isolated evaluations | Supported agent/model configuration, discovery adapters and evaluation repeat set |
| Owner recovery | Security deprovisioning revokes sole-owner access; verified recovery command | Evidence of organizational authority, recovery approvers and escalation contacts |
| Pricing | Versioned free/trial/fixed/seat definitions | Price amounts, currencies, trial rules, seat classes, grace duration |
| Metered charges | Disabled; local ledger/quotas included | Provider, metric contracts, allowed overages, credits, hybrid charge ownership |
| Retention | Configurable by data class | Required audit/financial retention, deletion grace, contractual holds |
| Recovery control plane | Independent journal/epoch/readiness/evidence; application restores require credential replacement and access revalidation under `R-RECOVERY` | Provider, failure domains, backup horizon, completeness, independent identity/owner evidence and achievable RTO |
| File finalization | Private staging plus immutable approved object identity | Adapter create-once/version guarantees and download revocation window |
| Availability/scale | Reference targets in operations plan | Paid SLA, recovery commitments, target tenant/resource/event volume |
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

Track operational costs by database/backups, worker/FGA compute, object storage/egress, email, monitoring, analytics, agent evaluation runs, identity services, and billing services. Establish budgets after selecting a deployment and expected usage; this plan does not assume current vendor prices.
