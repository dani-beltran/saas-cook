# 6. Delivery roadmap

## 6.1 Delivery strategy

Build a working vertical slice before expanding the catalogue. Prove identity, tenant isolation, resource permissions, a real database transaction, a dashboard operation, audit, and asynchronous delivery together. Implement provider-independent entitlement/capacity and service-principal primitives before the reference feature's acceptance suite. Extract the generator only after the slice passes authorization safety and availability gates, then use it for subsequent modules.

All phases below are planned. Completion requires demonstrated acceptance criteria; a stub adapter, hidden navigation item, or documentation entry is not an implemented capability.

## 6.2 Phases and acceptance gates

| Phase | Deliverables | Depends on | Exit gate | Effort estimate |
| --- | --- | --- | --- | --- |
| 0. Validate decisions | Threat model; dependency/license/version matrix; identity/sole-owner recovery spike; RLS/pool spike; generation-isolated OpenFGA prototype; hot-tenant benchmark; independent recovery-store design; billing/storage adapter feasibility | This plan | Versions/mapping resolved; late-write fault suite and healthy availability budgets pass; recovery ownership and immutable-object contract recorded in ADRs | 2–4 engineer-weeks |
| 1. Repository and runtime | pnpm/Turborepo; Next/React/TS/shadcn shell; worker; local services; config validation; CI; telemetry skeleton; test fixtures | 0 | Documented bootstrap starts web/worker/dependencies and passes smoke/type/build checks | 1–2 |
| 2. Identity and tenancy | Authentication/MFA/sessions and required email; organizations/members/invitations/teams; optional workspaces; tenant context/RLS and mutation audit/outbox; typed local policy catalogue and shared seat-admission service; owner-recovery command/runbook; account/org UI | 1 | Two-tenant isolation passes; local capacity and voluntary-owner/security-revocation races pass; safe bootstrap/recovery and multi-tab switching | 3–5 |
| 3. Authorization and reference feature | Selected graph protocol, generations/readiness/fences and independent epoch control; service-account/API-key enforcement and provisioning commands; generic capacity reservations; Project CRUD/search/pagination; API/DTO/concurrency | 2 | Project works with local policies and no billing credentials; quota/key/late-write suites pass; real feature meets Phase 0 availability and create-to-readable targets | 5–8 |
| 4. Entity CLI | Versioned declaration schema; create/plan/evolve/doctor; staged generation; migration/RLS integration; owned/custom files; foundation tests/docs and preset dependency validation | 3 | Generate Project + child Task and explicit service-account variant; foundation suites pass without commercial modules; second run has no diff; custom code/data survive evolution | 3–5 |
| 5. Monetization | Plans, fixed/seat billing, portal, webhook inbox, commercial entitlement sources, ledger/windowed quotas, usage dashboard, reconciliation and notices | 4 | Provider lifecycle and replay/out-of-order tests pass; provider downgrades and admission races converge; no duplicate semantic charge or usage | 4–6 |
| 6. Platform modules and baseline recovery | Immutable file finalization/import/export; organization deletion and independent journal; gated backup/restore; notifications; API-key/service-account customer UI; webhooks/integrations/flags; audit/help/public UI | 5 | File overwrite/finalization races and isolation pass; deletion after backup and mismatched-store restore cannot reopen access; baseline restore drill/runbooks pass before customer data | 4–6 |
| 7. Enterprise administration | OIDC/SAML, SCIM, custom roles, security policies, guests, contract overrides, operator/support UI, advanced retention/legal-hold hooks | 6 | Real IdP deprovisioning is organization-scoped, including sole owner; SCIM uses shared seat admission; recovery/support/policy actions fully audited | 4–7 |
| 8. Hardening and template release | Expanded performance/failure/recovery drills, measured RPO/RTO, accessibility, upgrade rehearsal, deployment/runbooks, bootstrap presets, release provenance | 7 | All applicable release gates pass on reference deployment; tagged template release with documented limitations | 3–5 |

Revised indicative total: **29–48 engineer-weeks** for the enterprise baseline, including the expanded authorization prototype and baseline recovery work. With two experienced full-stack engineers and part-time product/design/security/operations support, allow roughly **18–30 calendar weeks**, depending on integration access and discovery. These are planning estimates, not delivery commitments; a failed Phase 0 architecture gate requires re-estimation before implementation proceeds. Re-estimate again after Phase 3. Advanced extensions are additional scope.

Milestones:

- **M1 Foundation:** Phases 0–4. Runnable foundation preset, reference domain, real local entitlements/capacity, service-principal enforcement, and entity generation; full commercial/export/deletion workflows are outside this milestone.
- **M2 Commercial core:** through Phase 6. A product can sell subscriptions and operate common SaaS workflows after demonstrating baseline backup/restore, organization export/deletion, and the applicable module suites.
- **M3 Enterprise baseline:** through Phase 8. Enterprise identity/governance and operational recovery have been demonstrated.

### Capability-to-phase and acceptance matrix

This matrix resolves cross-document release boundaries. F/C/E labels describe when behavior is usable; later customer UI or provider integration does not postpone the enforcement primitive needed by an earlier phase. Phase 0 uses prototypes to settle contracts; shipping acceptance runs on the implemented services. Commercial customer data requires the Phase 6 baseline recovery gate even if billing functionality is available in Phase 5.

| Capability | First implementation | Acceptance evidence | Later extension |
| --- | --- | --- | --- |
| Authorization projection and late-write isolation | Phase 0 prototype; F / 3 production path | Old grant request completes after a newer revocation; abandoned attempt cannot activate or change current access | Re-run on generated features and E / 8 deployment |
| Hot-tenant availability | Phase 0 decision gate; F / 3 real slice | Operations §4.7 workload, first-attempt failures, fence waits, create-to-readable latency and graph build/cleanup cost | C bulk jobs and E / 8 capacity testing |
| Local entitlement/capacity policy | F / 2–3 | Project quota race and disabled-provider preset pass with real database enforcement | C / 5 sold-plan sources and usage windows; E / 7 contracts |
| Membership seat admission | F / 2 | Invite/reactivation/role/bootstrap/recovery races use one transition service | C / 5 provider downgrade races; E / 7 real SCIM |
| Service accounts/API keys | F / 3 | Scoped, expired, revoked and wrong-tenant keys; explicit policy capability required | C / 6 customer administration UI |
| Last-owner protection and security override | Phase 0 adapter spike; F / 2 command/runbook | Voluntary last-owner change refused; security deactivation enters recovery without preserving access | E / 7 real SCIM sole-owner case and operator UI |
| Required identity/security emails | F / 2 | Verification/reset/invite/recovery delivery, retry and redaction | C / 6 full notification preferences/in-app delivery |
| Foundation generator | F / 4 | All ten Foundation checks in generator §5.8; no billing credentials or skipped quota/key tests | C/E module suites added only with implemented modules |
| Files/import/export | C / 6 | Staging overwrite, exact scanned bytes, concurrent finalization, authorized export/download | Further formats/providers require adapter tests |
| Organization export/deletion and baseline retention | C / 6 | Journal acknowledgement, deletion/cancellation replay, provider settlement and scoped export | E / 7 advanced retention/legal holds |
| Recovery readiness and independent journal | Phase 0 design; C / 6 complete baseline | Mismatched snapshots, restore of only one store, deletion after backup, journal outage and old projector arrival all keep traffic gated | E / 8 measured RPO/RTO and expanded drills |

The generator's export/file and enterprise-identity suites are mandatory for presets that enable those modules, not prerequisites for the Foundation milestone. Foundation still rejects undeclared endpoints and unknown dependencies. No stub adapter or skipped required suite satisfies a milestone.

## 6.3 Initial implementation backlog

| ID | Work item | Acceptance evidence |
| --- | --- | --- |
| ARCH-01 | Record stack/version matrix and deployment ADR | Supported versions, licenses, upgrade policy, and dependency ownership documented |
| SEC-01 | Threat-model browser/API/worker/provider boundaries | Tenant forgery, confused-deputy, stale-grant, secret exposure, and billing replay scenarios mapped to controls/tests |
| DB-01 | Prove PostgreSQL transaction-local tenant context | Actual pooled connections alternate tenants; missing context/cross-tenant FK fail under runtime roles |
| AUTH-01 | Prove identity-to-membership mapping and sole-owner recovery | SSO/SCIM affect only intended organization; sole-owner deactivation revokes access and enters verified recovery; no unsafe email-only linking |
| AUTHZ-01 | Prototype generation-isolated projection and publication | Lost DB lock plus late remote grant after newer revocation cannot restore access; ambiguous attempts never activate; model/epoch and cross-generation edges validated |
| AUTHZ-02 | Run Phase 0 hot-tenant decision benchmark | Operations §4.7 workload meets failure, latency, lock-wait and create-to-readable budgets; graph copying/cleanup measured; redesign required on failure |
| REC-01 | Design independent journal and recovery readiness | Record failure domains, durability/retention/completeness rules, fresh recovery epoch, graph rebuild, and gate ownership in Phase 0; full baseline drill in Phase 6 |
| FILE-01 | Prove immutable finalization adapter | No staging overwrite changes approved bytes; finalization/scan are bound to a fixed object identity; publication and capacity settle once in Phase 6 |
| DEV-01 | Create monorepo, typed config, local dependencies | Fresh clone can start services without production credentials |
| DEV-02 | Build CI and two-organization synthetic fixtures | Repeatable integration environment; migrations/build/type checks run in CI |
| UI-01 | Build shell, theme, organization routing, form/table patterns | Responsive keyboard-accessible shell; tenant change clears relevant state |
| TEN-01 | Implement organization/member/invitation lifecycle | Single-use invites; shared admission for activation/role/owner changes; security deactivation wins over owner-count and capacity rules |
| QUOTA-01 | Implement local typed policies and transactional capacity | Foundation Project runs with billing disabled; create/restore races cannot spend capacity twice |
| API-01 | Implement context/error/DTO/idempotency and service-principal boundary | Direct API calls cannot bypass checks; expiring/scoped/revoked keys and explicit principal capabilities tested by Phase 3 |
| DOMAIN-01 | Build Project vertical slice by hand | Mutation, generation readiness, audit/outbox, quotas, conflict, list UI and measured create-to-readable behavior pass together |
| GEN-01 | Extract generator IR and templates from Project | Declared Project produces equivalent behavior and passes platform security tests |

Implement security primitives before generation. Add optional UI controls only after their server behavior exists. Do not ship visible placeholder enterprise settings that imply working protection.

## 6.4 Release checklist

### Security and identity

- [ ] All tenant tables carry the expected key, constraints, policies, and restricted-role coverage.
- [ ] List/read/write/count/search/file/export/job/API tests cover cross-tenant attacks and forged contexts.
- [ ] Direct grants, team grants, membership revocation, parent changes, and custom-role updates cannot use a stale graph.
- [ ] An old projector write completing after lock loss and a newer revocation cannot alter current access; abandoned generations never activate and graph traversal cannot cross generations.
- [ ] FGA/model/projection failures deny dependent access predictably and expose safe recovery diagnostics.
- [ ] MFA, session revocation, SSO enforcement, SCIM deprovisioning, key rotation, and last-owner transfer are tested.
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

### Generator and developer experience

- [ ] Generated feature migrates, builds, appears in navigation, and completes the dashboard/API workflow.
- [ ] Generated RLS/permissions/audit/DTO policies are enforced, including on manually invoked APIs.
- [ ] Foundation generator suites pass with real local entitlements/quotas and API-key enforcement and no commercial credentials; enabled C/E modules add their applicable suites.
- [ ] Regeneration is deterministic and preserves developer-owned files and historical migrations.
- [ ] Entity evolution handles data/backfill/API/model compatibility or refuses with a precise migration plan.
- [ ] Renaming a new product updates manifests, branding, package identifiers, emails, and example content.
- [ ] Template updates have a tested previous-release migration/codemod path.

### Operations and customer experience

- [ ] Local setup uses only synthetic data; production startup rejects missing/unsafe secrets and origins.
- [ ] Logs/metrics/traces, alerts, dead-letter views, and reconciliation runbooks are usable.
- [ ] The documented workload meets measured targets; permissions, exports, and tenant fairness are included.
- [ ] Phase 0 and the real Phase 3 slice meet healthy hot-tenant failure/lock-wait/create-to-readable gates before generator extraction; retries do not conceal first-attempt failures.
- [ ] Exact immutable object identity binds upload finalization, scan approval and download; staging overwrite and duplicate-finalization races cannot publish unscanned bytes or double-settle capacity.
- [ ] Baseline recovery passes in C before customer data; independent journal completeness, fresh epoch and rebuilt graph are verified before any tenant serving/worker effects resume.
- [ ] E recovery meets measured RPO/RTO and tests mismatched stores, later deletions, journal outage, partial rebuild and late old projector requests.
- [ ] Tenant export/deletion, provider cancellation, retention exceptions, and backup expiry are exercised.
- [ ] Dashboard forms/tables/dialogs pass keyboard/accessibility checks and display all failure states.
- [ ] Incident response, dependency updates, security contact, and deployment rollback/forward-fix ownership are assigned.

## 6.5 Configuration and adoption decisions

These defaults guide implementation, subject to the mandatory Phase 0 authorization, identity, storage, and recovery design gates. Product-specific choices below remain configurable; no default waives an acceptance gate.

| Topic | Template default | Product-specific decision |
| --- | --- | --- |
| Naming | `common-sass` | Name/branding/package namespace for each generated product |
| Tenant/billing boundary | One organization, one billing account | Consolidated billing across several organizations? |
| Content administration | Org admins manage all tenant content | Need private content hidden even from tenant administrators? |
| Guests | Explicit limited membership, disabled until E | Are guests billable and how long may grants last? |
| Hosting | Single-region portable containers, shared PostgreSQL | Cloud/region, residency, network controls, dedicated tenants |
| Authentication | Better Auth adapter; application-owned organization lifecycle | Identity vendor, self-service SSO licensing, supported IdPs |
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
| Generator milestone depends on later commercial modules | Local policy/quota/key primitives in F / 2–3; explicit foundation/module acceptance split and capability matrix |
| Identity plugin and application membership disagree | One documented source of truth; mapping/deprovisioning spike before organization implementation |
| Billing replay or ambiguous state creates bad access/charges | Durable commands/inbox, idempotency, serialized projection, independent reconciliation |
| Codegen destroys customization or history | Ownership manifest, staged diff, no edit of applied migrations, evolution/codemod tests |
| Shared database introduces noisy tenants | Tenant fairness, query/index budgets, separate worker pools, measured path to dedicated placement |
| Optional provider costs undermine a reusable template | Local fakes, adapters, optional modules, verified vendor terms; record operational cost categories |
| Generated features look complete but miss security | Required integration/security acceptance tests; no bypassable transport-only checks |

Track operational costs by database/backups, worker/FGA compute, object storage/egress, email, monitoring, identity services, and billing services. Establish budgets after selecting a deployment and expected usage; this plan does not assume current vendor prices.
