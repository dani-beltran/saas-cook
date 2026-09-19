# 6. Delivery roadmap

## 6.1 Delivery strategy

Build a working vertical slice before expanding the catalogue. Prove identity, tenant isolation, resource permissions, a real database transaction, a dashboard operation, audit, and asynchronous delivery together. Implement provider-independent entitlement/capacity and service-principal primitives before the reference feature's acceptance suite. Extract AI agent skills from the proven slice after authorization safety and availability gates pass, then use them for subsequent modules. Validate resulting code with deterministic tools and evaluate skill behavior separately.

All phases below are planned. Completion requires demonstrated acceptance criteria; a stub adapter, hidden navigation item, or documentation entry is not an implemented capability.

## 6.2 Phases and acceptance gates

| Phase | Deliverables | Depends on | Exit gate | Effort estimate |
| --- | --- | --- | --- | --- |
| 0. Validate decisions | Threat model; required-stack dependency/license/version matrix, including React 19 and Bun workspace compatibility; oRPC/Zod/Next.js adapter spike; magic-link/passkey assurance and ownership/account-lifecycle race spike; RLS/pool spike; generation-isolated OpenFGA prototype; hot-tenant benchmark; independent recovery-store design; billing/storage/analytics adapter feasibility; Docker host/registry/tool versions and CI identity/network ADR | This plan | Required technologies have compatible versions and mappings; late-write fault suite and healthy availability budgets pass; recovery ownership, immutable-object contract, and deployment ownership recorded in ADRs | 3–5 engineer-weeks |
| 1. Repository and runtime | Bun/Turborepo; Next.js/React 19/TypeScript/shadcn/ui/Tailwind shell; next-intl/forms/Storybook patterns; worker; local services; T3 Env; oRPC skeleton; GitHub Actions and quality toolchain; AGENTS.md; combined web/worker application image and GHCR; direct Docker staging and deployment scripts; LogTape/OpenTelemetry; test fixtures | 0 | Phase 1 required-stack gates below pass; one application container runs web/worker without Kubernetes tooling; child-process failure/shutdown, migration ordering, failed replacement and compatible rollback preserve synthetic data | 2–4 |
| 2. Identity and tenancy | Self-hosted Better Auth/MFA/sessions, email magic links, passkey enrollment/recovery and required React Email templates; organizations/members/invitations/teams and accepted ownership transfer; Drizzle/PostgreSQL lifecycle fences, tenant context/RLS and audit/outbox; local policy and shared seat admission; owner-recovery command/runbook and account/org UI | 1 | Passwordless replay/origin/assurance/recovery tests pass; two-tenant isolation, transfer/admission/deprovisioning races, safe bootstrap and multi-tab switching pass | 4–6 |
| 3. Authorization and reference feature | Selected graph protocol, generations/readiness/fences and independent epoch control; service-account/API-key enforcement and provisioning commands; generic capacity reservations; Project CRUD/search/pagination; oRPC/Zod contracts, typed client, public OpenAPI and concurrency | 2 | Project works with local policies and no billing credentials; both oRPC transports pass quota/key/late-write suites; real feature meets Phase 0 availability and create-to-readable targets | 5–8 |
| 4. AI agent skills | Bootstrap/add/evolve/verify feature skills, dashboard/email skills, feature briefs, shared references, discovery adapters and isolated behavior evaluations; deterministic migration/RLS/API checks | 3 | Agent implements Project + child Task and service-account variant; held-out behavior suites pass without commercial credentials; evolution/resume preserves custom code/data/history; repeated requests add no duplicate artifacts | 3–5 |
| 5. Monetization | Plans, Stripe fixed/seat billing, Checkout and Customer Portal, webhook inbox, commercial entitlement sources, ledger/windowed quotas, usage dashboard, reconciliation and notices | 4 | Stripe lifecycle and replay/out-of-order tests pass; provider downgrades and admission races converge; no duplicate semantic charge or usage | 4–6 |
| 6. Platform modules and baseline recovery | Files/import/export; personal account deletion with ownership continuity; organization deletion and independent journal for both scopes; product analytics events/reports/controls/cleanup; gated restore; notifications/API-key UI/webhooks/integrations/flags; audit/help/public UI and production promotion | 5 | Analytics attribution/preferences/outage/late-delivery deletion pass; multi-org account closure preserves continuing tenants/billing; immutable files and journal restore cannot revive deleted users/tenants; baseline recovery and production checks pass before customer data | 6–9 |
| 7. Enterprise administration | OIDC/SAML, SCIM, custom roles, security policies, guests, contract overrides, operator/support UI, advanced retention/legal-hold hooks | 6 | Real IdP deprovisioning is organization-scoped, including sole owner; SCIM uses shared seat admission; recovery/support/policy actions fully audited | 4–7 |
| 8. Hardening and template release | Expanded performance/failure/recovery drills, measured RPO/RTO, accessibility, upgrade rehearsal, deployment/runbooks, bootstrap presets, release provenance | 7 | All applicable release gates pass on reference deployment; tagged template release with documented limitations | 3–5 |

Revised indicative total: **34–55 engineer-weeks** for the enterprise baseline, including passwordless identity, account lifecycle/ownership transfer, product analytics, agent-skill evaluation, the authorization prototype, direct Docker delivery, and baseline recovery. Replacing the custom generator removes its DSL/rendering engine work but does not assume an unmeasured AI productivity gain. Phase 1 retains 1–2 engineer-weeks for combined-process packaging, image publication, Docker staging, and deployment/rollback validation. Kubernetes provisioning, split images, Helm tooling and cluster validation are optional additional scope, estimated separately when selected. With two experienced full-stack engineers and part-time product/design/security/operations support, allow roughly **21–34 calendar weeks**, depending on integration access and discovery. These are planning estimates, not delivery commitments; a failed Phase 0 architecture gate requires re-estimation before implementation proceeds. Re-estimate again after Phase 3 and the first Phase 4 skill evaluations. Advanced extensions are additional scope.

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

This matrix resolves cross-document release boundaries. F/C/E labels describe when behavior is usable; later customer UI or provider integration does not postpone the enforcement primitive needed by an earlier phase. Phase 0 uses prototypes to settle contracts; shipping acceptance runs on the implemented services. Commercial customer data requires the Phase 6 baseline recovery gate even if billing functionality is available in Phase 5.

| Capability | First implementation | Acceptance evidence | Later extension |
| --- | --- | --- | --- |
| CI/CD and single-container Docker deployment | Phase 0 deployment ADR; F / 1 combined image, registry, Docker staging and scripts | Web + worker run in one persistent application container; fresh install, process failure, migration failure, unhealthy replacement and compatible rollback pass without Kubernetes; F / 3–4 adds deployed reference/agent-authored feature suites | C / 6 protected production promotion and recovery gate; E / 8 capacity/upgrade/provenance drills |
| Kubernetes/Helm deployment | X / optional after the Docker delivery contract is established | Split images, fresh namespace install, migration/model Jobs, rolling upgrade and compatible rollback pass on a reference cluster | Independent scaling; never a prerequisite for Docker-only F/C/E milestones |
| Authorization projection and late-write isolation | Phase 0 prototype; F / 3 production path | Old grant request completes after a newer revocation; abandoned attempt cannot activate or change current access | Re-run on agent-authored features and E / 8 deployment |
| Hot-tenant availability | Phase 0 decision gate; F / 3 real slice | Operations §4.7 workload, first-attempt failures, fence waits, create-to-readable latency and graph build/cleanup cost | C bulk jobs and E / 8 capacity testing |
| Local entitlement/capacity policy | F / 2–3 | Project quota race and disabled-provider preset pass with real database enforcement | C / 5 sold-plan sources and usage windows; E / 7 contracts |
| Membership seat admission | F / 2 | Invite/reactivation/role/bootstrap/recovery races use one transition service | C / 5 provider downgrade races; E / 7 real SCIM |
| Service accounts/API keys | F / 3 | Scoped, expired, revoked and wrong-tenant keys; explicit policy capability required | C / 6 customer administration UI |
| Last-owner protection and security override | Phase 0 adapter spike; F / 2 command/runbook | Voluntary last-owner change refused; security deactivation enters recovery without preserving access | E / 7 real SCIM sole-owner case and operator UI |
| Email magic links | Phase 0 adapter contract; F / 2 | Atomic single use, expiry, scanner confirmation, generic responses, safe redirects and tenant SSO/MFA enforcement | E / 7 identity-provider policies |
| Passkeys | Phase 0 origin/RP/assurance contract; F / 2 | Enrollment/sign-in/revoke, replay/origin rejection, multiple credentials, recovery and passwordless sensitive actions | E / 7 enforced enterprise policy |
| Ownership transfer and lifecycle fences | F / 2 | Verified active recipient acceptance, expiry/cancel, same-tenant/version checks, role/seat atomicity and deprovisioning races | C / 6 multi-org closure and recovery receipts |
| Required identity/security emails | F / 2 | Verification/reset/magic-link/invite/transfer/recovery delivery, retry and redaction | C / 6 full preferences/in-app delivery and deletion notices |
| Foundation AI agent skills | F / 4 | All ten evaluation tasks in skills §5.7 plus deterministic checks; preserved customization/history; no billing credentials or skipped quota/key tests | C/E suites in §5.8 only with implemented modules |
| Product analytics | C / 6 | Typed events/report fixtures, user/org attribution, tracking controls, redaction, bounded outages, provider cleanup and restore suppression | Additional providers/reports through tested adapters |
| Personal account deletion | C / 6 | All-org ownership resolution, credential revocation, resumable cleanup, preserved tenant subscriptions and account/transfer-after-backup replay | E / 7 advanced retention and SCIM cases |
| Files/import/export | C / 6 | Staging overwrite, exact scanned bytes, concurrent finalization, authorized export/download | Further formats/providers require adapter tests |
| Organization export/deletion and baseline retention | C / 6 | Journal acknowledgement, deletion/cancellation replay, provider settlement and scoped export | E / 7 advanced retention/legal holds |
| Recovery readiness and independent journal | Phase 0 design; C / 6 complete baseline | Mismatched snapshots, restore of only one store, deletion after backup, journal outage and old projector arrival all keep traffic gated | E / 8 measured RPO/RTO and expanded drills |

The skills' export/file and enterprise-identity suites are mandatory for presets that enable those modules, not prerequisites for the Foundation milestone. Foundation still rejects undeclared endpoints and unknown dependencies. No stub adapter or skipped required suite satisfies a milestone.

## 6.3 Initial implementation backlog

| ID | Work item | Acceptance evidence |
| --- | --- | --- |
| ARCH-01 | Record stack/version matrix and deployment ADR | Supported versions, licenses, Docker host/registry provider, runner connectivity, deployment identity/trust, upgrade policy, and infrastructure ownership documented |
| SEC-01 | Threat-model browser/API/worker/provider boundaries | Tenant forgery, confused-deputy, stale-grant, secret exposure, and billing replay scenarios mapped to controls/tests |
| DB-01 | Prove PostgreSQL transaction-local tenant context | Actual pooled connections alternate tenants; missing context/cross-tenant FK fail under runtime roles |
| AUTH-01 | Prove identity-to-membership mapping and sole-owner recovery | SSO/SCIM affect only intended organization; sole-owner deactivation revokes access and enters verified recovery; no unsafe email-only linking |
| AUTHZ-01 | Prototype generation-isolated projection and publication | Lost DB lock plus late remote grant after newer revocation cannot restore access; ambiguous attempts never activate; model/epoch and cross-generation edges validated |
| AUTHZ-02 | Run Phase 0 hot-tenant decision benchmark | Operations §4.7 workload meets failure, latency, lock-wait and create-to-readable budgets; graph copying/cleanup measured; redesign required on failure |
| REC-01 | Design independent journal and recovery readiness | Record failure domains, durability/retention/completeness rules, fresh recovery epoch, graph rebuild, and gate ownership in Phase 0; full baseline drill in Phase 6 |
| FILE-01 | Prove immutable finalization adapter | No staging overwrite changes approved bytes; finalization/scan are bound to a fixed object identity; publication and capacity settle once in Phase 6 |
| DEV-01 | Create Bun/Turborepo monorepo, T3 Env/Zod config, local dependencies and AGENTS.md | Pinned Bun and committed lockfile reproduce setup; invalid runtime config fails early; fresh clone can start services without production credentials; agent context matches commands |
| DEV-02 | Build GitHub Actions CI with Vitest/Playwright and two-organization synthetic fixtures | Repeatable integration environment; Biome/TypeScript/Commitlint/Knip, applicable security/integration/browser suites, fresh/upgrade migrations, Storybook and production builds gate merges |
| DEV-03 | Implement combined `app` Docker target and release publication | Non-root container supervises web/worker; one-off migration/publication modes work; GHCR digest, scans, SBOM/provenance and signatures map to the tested commit; PR jobs cannot publish |
| DEV-04 | Configure Biome, Commitlint, Lefthook and Knip | pre-commit and commit-msg hooks invoke shared policies; CI rejects formatting/lint/commit violations and unexplained unused code/dependencies even when local hooks are skipped |
| DEV-05 | Configure LogTape logging and redaction with OpenTelemetry correlation | Web/worker request, job and trace references correlate; credentials, authentication URLs and sensitive payloads are excluded from output |
| OPS-01 | Prepare Docker staging and direct-container deployment | Host bootstrap, environment isolation, external services, secrets, TLS proxy, health checks and limits; one application container passes smoke, shutdown and host reboot checks |
| OPS-02 | Implement serialized migration, Docker deployment, and promotion workflows | One-off commands from the same app digest finish before compatible replacement; identical digest promoted; failed migration/readiness blocks success; compatible rollback preserves data |
| OPS-03 | Complete production delivery and operational handover in Phase 6 | Protected environment, short-lived scoped access, secret rotation, ownership/runbooks and baseline restore pass before customer data |
| OPS-X01 | Optional Kubernetes adapter and Helm chart | Split image targets, cluster access, manifests/Jobs, isolation, rollout and rollback pass adapter-specific checks; tracked outside the required baseline |
| UI-01 | Build React 19/Next.js shell with shadcn/ui, Tailwind CSS, next-intl, React Hook Form/Zod and Storybook | Responsive keyboard-accessible shell; locale/theme/form-state stories build; tenant change clears relevant state |
| TEN-01 | Implement organization/member/invitation lifecycle | Single-use invites; shared admission for activation/role/owner changes; security deactivation wins over owner-count and capacity rules |
| QUOTA-01 | Implement local typed policies and transactional capacity | Foundation Project runs with billing disabled; create/restore races cannot spend capacity twice |
| API-01 | Implement oRPC contracts/procedures, typed client, OpenAPI and context/error/DTO/idempotency/service-principal boundary | Runtime Zod validation and TypeScript client checks pass; RPC and REST calls cannot bypass checks; expiring/scoped/revoked keys and explicit principal capabilities tested by Phase 3 |
| DOMAIN-01 | Build Project vertical slice by hand | Mutation, generation readiness, audit/outbox, quotas, conflict, list UI and measured create-to-readable behavior pass together |
| SKILL-01 | Extract the six agent skills and supporting references from the proven slice | Isolated repeat evaluations implement/evolve Project/Task, preserve customization/history and pass held-out security/behavior checks |
| AUTH-02 | Implement email magic links in Phase 2 | Hashed single-use expiry, safe confirmation/redirects, scanner/replay races and tenant-policy enforcement |
| AUTH-03 | Implement passkeys in Phase 2 | Verified RP/origin/challenge/assurance, enrollment/revoke/recovery and passwordless reauthentication |
| TEN-02 | Implement accepted ownership transfer and account lifecycle fences in Phase 2 | Transfer/admission/freeze/deprovisioning races preserve ownership, seat counts and revocation |
| ACC-01 | Implement personal account deletion in Phase 6 | Multi-org prerequisites, independent journal, provider cleanup, credential revocation, retained tenant data/billing and restore tests |
| ANALYTICS-01 | Implement product analytics in Phase 6 | Catalogue/reference adapter, defined reports and fixtures, tracking controls, attribution, redaction, outage and deletion reconciliation |

Implement security primitives before extracting agent skills. Add optional UI controls only after their server behavior exists. Do not ship visible placeholder enterprise settings that imply working protection.

## 6.4 Release checklist

### Security and identity

- [ ] All tenant tables carry the expected key, constraints, policies, and restricted-role coverage.
- [ ] List/read/write/count/search/file/export/job/API tests cover cross-tenant attacks and forged contexts.
- [ ] Direct grants, team grants, membership revocation, parent changes, and custom-role updates cannot use a stale graph.
- [ ] An old projector write completing after lock loss and a newer revocation cannot alter current access; abandoned generations never activate and graph traversal cannot cross generations.
- [ ] FGA/model/projection failures deny dependent access predictably and expose safe recovery diagnostics.
- [ ] MFA, session revocation, SSO enforcement, SCIM deprovisioning, key rotation, and accepted ownership transfer are tested.
- [ ] Magic-link single use/expiry/scanner handling and passkey RP/origin/assurance/recovery pass, including passwordless-only sensitive actions.
- [ ] Personal deletion resolves every ownership obligation, survives concurrent transfers/admission, revokes credentials, and preserves continuing organizations and subscriptions.
- [ ] Sole-owner security/SCIM deprovisioning removes access even during FGA outage, enters owner recovery, and requires independently verified replacement admission; voluntary last-owner removal remains refused.
- [ ] Required field-level restrictions, redaction, CSRF/origin/CORS policies, and operator boundaries are verified.

### Commercial correctness

- [ ] Fixed and seat subscriptions pass creation, upgrade, downgrade, renewal, delinquency, cancellation, and recovery scenarios.
- [ ] Duplicate/out-of-order/missed provider events converge to current state through replay and reconciliation.
- [ ] Plan entitlements, feature flags, permissions, hard quotas, and rate limits remain independent.
- [ ] Seat and quota concurrency tests prove capacity cannot be spent twice.
- [ ] Seat admission covers bootstrap, invite/SCIM/reactivation/role/ownership changes and provider downgrades; deactivation never waits for billing or owner transfer.
- [ ] Usage deduplication, corrections, period boundaries, job retry, and billing reconciliation are covered.
- [ ] Optional metered charging is labelled disabled unless a live-capable adapter has passed its separate contract tests.

### AI agent skills and developer experience

- [ ] All required-stack delivery gates pass for the release's phases; versions are pinned and the Bun lockfile is reproducible.
- [ ] Biome, Commitlint, Lefthook and Knip use documented shared policies; GitHub Actions enforces checks independently of local hooks.
- [ ] Vitest and Playwright suites, strict TypeScript checks, Storybook and production builds run through the documented Bun scripts.
- [ ] AGENTS.md records the actual stack, boundaries and commands; skills and feature examples use oRPC, next-intl and the shared UI/form patterns.
- [ ] Agent-authored feature migrates, builds, appears in navigation, and completes the dashboard/API workflow.
- [ ] RLS/permissions/audit/DTO policies in agent-authored code are enforced, including on manually invoked APIs.
- [ ] Foundation skill evaluation and deterministic behavior suites pass with real local entitlements/quotas and API-key enforcement and no commercial credentials; enabled C/E modules add their applicable suites.
- [ ] Skills preserve ordinary developer-owned source, customizations and migration history; repeat/resume does not duplicate migrations or registrations.
- [ ] Isolated skill evaluations record task/skill/template/model versions and held-out behavioral results; application CI does not require a live AI service.
- [ ] Feature evolution handles data/backfill/API/model compatibility or refuses with a precise migration plan.
- [ ] Renaming a new product updates manifests, branding, package identifiers, emails, and example content.
- [ ] Template updates have a tested previous-release migration/codemod path.

### Operations and customer experience

- [ ] Local setup uses only synthetic data; T3 Env rejects missing/unsafe runtime secrets and origins before serving or processing jobs.
- [ ] [CI/CD plan](07-ci-cd-and-deployment.md) is implemented: required CI checks, tested combined Docker image, registry publication, signed provenance, and retained release digest/configuration.
- [ ] Direct Docker staging install and upgrade run web/worker in one application container without Kubernetes; production promotion uses the same verified digest, isolated environment access, and protected release approval.
- [ ] One-off migration/model commands gate replacement; failed migration, unavailable image, failed combined health and incompatible rollback stop release; compatible rollback passes synthetic data and worker checks.
- [ ] If Kubernetes is enabled, its split-image/chart/Job/rollout tests pass; a Docker-only release does not depend on this optional gate.
- [ ] LogTape logs and redaction, OpenTelemetry metrics/traces, alerts, dead-letter views, and reconciliation runbooks are usable.
- [ ] The documented workload meets measured targets; permissions, exports, and tenant fairness are included.
- [ ] Phase 0 and the real Phase 3 slice meet healthy hot-tenant failure/lock-wait/create-to-readable gates before skill extraction; retries do not conceal first-attempt failures.
- [ ] Exact immutable object identity binds upload finalization, scan approval and download; staging overwrite and duplicate-finalization races cannot publish unscanned bytes or double-settle capacity.
- [ ] Baseline recovery passes in C before customer data; independent journal completeness, fresh epoch and rebuilt graph are verified before any tenant serving/worker effects resume.
- [ ] E recovery meets measured RPO/RTO and tests mismatched stores, later deletions, journal outage, partial rebuild and late old projector requests.
- [ ] Account and organization deletion, accepted transfer replay, provider cleanup/cancellation, retention exceptions, and backup expiry are exercised.
- [ ] Product analytics reports pass known-cohort fixtures and honor user/organization tracking policy, redaction, tenant switching, delayed retries, deletion suppression and provider outages.
- [ ] Dashboard forms/tables/dialogs pass keyboard/accessibility checks and display all failure states.
- [ ] Incident response, dependency updates, security contact, and deployment rollback/forward-fix ownership are assigned.

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
| Recovery control plane | Journal and epoch/readiness survive independently of both database restores | Provider, failure domains, backup horizon and journal completeness mechanism |
| File finalization | Private staging plus immutable approved object identity | Adapter create-once/version guarantees and download revocation window |
| Availability/scale | Reference targets in operations plan | Paid SLA, recovery commitments, target tenant/resource/event volume |
| Legal/compliance | Controls, evidence, and configuration hooks | Required agreements, certifications, regional obligations |

## 6.6 Risks and mitigation

| Risk | Mitigation and decision gate |
| --- | --- |
| Excessive scope makes the template hard to adopt | Modular presets; demonstrate F before C/E; optional extensions remain removable |
| A late projector request restores an obsolete grant | Unique immutable generations per attempt, conditional publication, recovery epoch, and the exact lost-lock/late-write fault test; Phase 0 proves the protocol |
| Graph copies/fences make ordinary tenant traffic unavailable | Mandatory Phase 0 hot-tenant budgets including creates, sparse lists and first-attempt failures; redesign and re-estimate before Phase 3 if the candidate fails |
| Restore counters look current while graph or deletion history is wrong | Independent journal/readiness, new epoch, rebuilt generations, and mismatched-snapshot/deletion-after-backup drills before C customer data |
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
