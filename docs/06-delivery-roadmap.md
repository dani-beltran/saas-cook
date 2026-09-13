# 6. Delivery roadmap

## 6.1 Delivery strategy

Build a working vertical slice before expanding the catalogue. Prove identity, tenant isolation, resource permissions, a real database transaction, a dashboard operation, audit, and asynchronous delivery together. Extract the generator from that proven slice, then use it for subsequent modules.

All phases below are planned. Completion requires demonstrated acceptance criteria; a stub adapter, hidden navigation item, or documentation entry is not an implemented capability.

## 6.2 Phases and acceptance gates

| Phase | Deliverables | Depends on | Exit gate | Effort estimate |
| --- | --- | --- | --- | --- |
| 0. Validate decisions | Threat model; dependency/license/version matrix; identity integration spike; RLS/pool spike; OpenFGA consistency prototype; billing-provider feasibility | This plan | Compatible versions pinned; SSO/SCIM mapping demonstrated or adapter decision resolved; no unowned security boundary | 1–2 engineer-weeks |
| 1. Repository and runtime | pnpm/Turborepo; Next/React/TS/shadcn shell; worker; local services; config validation; CI; telemetry skeleton; test fixtures | 0 | Documented bootstrap starts web/worker/dependencies and passes smoke/type/build checks | 1–2 |
| 2. Identity and tenancy | Authentication/MFA/sessions; organizations; memberships/invitations; teams; optional workspaces; tenant DB context/RLS; account and org settings UI | 1 | Two-tenant isolation suite passes; final-owner and invite races covered; organization switching safe across tabs | 3–5 |
| 3. Authorization and reference feature | OpenFGA model/projector/fence; Project module; secure CRUD/search/pagination; outbox/audit baseline; API contracts; DTOs/concurrency | 2 | Create/share/revoke/edit/delete works end-to-end; delayed/replayed projection cannot permit obsolete access | 4–6 |
| 4. Entity CLI | Versioned declaration schema; create/plan/evolve/doctor; staged generation; migration/RLS integration; owned/custom files; generated tests/docs | 3 | Generate Project + child Task into clean fixtures; migrate/build/run; second run has no diff; custom code and existing data survive evolution | 3–5 |
| 5. Monetization | Plans, fixed/seat billing, portal, webhook inbox, entitlements, ledger, quotas, usage dashboard, reconciliation and notices | 3–4 | Provider test checkout/lifecycle works; replay/out-of-order tests pass; quota/seat races pass; no duplicate semantic charge or usage | 4–6 |
| 6. Platform modules | Files/import/export, notifications, API/service accounts, outgoing webhooks, integrations, flags, customer audit UI, help/public pages | 4–5 | Retry/offline paths work; file/export/search isolation verified; integration secrets and SSRF defenses tested | 3–5 |
| 7. Enterprise administration | OIDC/SAML, SCIM, custom roles, security policies, guests, contract overrides, operator/support console, retention/legal-hold hooks | 0, 2–6 | IdP lifecycle works in a representative test directory; deprovisioning is organization-scoped; support and policy changes fully audited | 4–7 |
| 8. Hardening and template release | Performance/failure testing, accessibility, upgrade rehearsal, backup/restore/deletion drills, deployment/runbooks, bootstrap presets, release provenance | 0–7 | All release gates below pass on the reference deployment; tagged template release with documented limitations | 3–5 |

Indicative total: **26–43 engineer-weeks** for the enterprise baseline. With two experienced full-stack engineers and part-time product/design/security/operations support, allow roughly **16–26 calendar weeks**, depending on integration access and discovery. These are planning estimates, not delivery commitments; re-estimate after Phases 0 and 3. Advanced extensions are additional scope.

Milestones:

- **M1 Foundation:** Phases 0–4. Usable secure template, reference domain, and entity generation.
- **M2 Commercial core:** through Phase 6. A product can sell subscriptions and operate common SaaS workflows.
- **M3 Enterprise baseline:** through Phase 8. Enterprise identity/governance and operational recovery have been demonstrated.

## 6.3 Initial implementation backlog

| ID | Work item | Acceptance evidence |
| --- | --- | --- |
| ARCH-01 | Record stack/version matrix and deployment ADR | Supported versions, licenses, upgrade policy, and dependency ownership documented |
| SEC-01 | Threat-model browser/API/worker/provider boundaries | Tenant forgery, confused-deputy, stale-grant, secret exposure, and billing replay scenarios mapped to controls/tests |
| DB-01 | Prove PostgreSQL transaction-local tenant context | Actual pooled connections alternate tenants; missing context/cross-tenant FK fail under runtime roles |
| AUTH-01 | Prove identity-to-membership mapping | SSO login and SCIM disable affect only intended organization; no unsafe email-only linking |
| AUTHZ-01 | Prototype strict graph projection fence | Tests cover revoke, partial write, crash/retry, queued order, model version, and unavailable FGA |
| DEV-01 | Create monorepo, typed config, local dependencies | Fresh clone can start services without production credentials |
| DEV-02 | Build CI and two-organization synthetic fixtures | Repeatable integration environment; migrations/build/type checks run in CI |
| UI-01 | Build shell, theme, organization routing, form/table patterns | Responsive keyboard-accessible shell; tenant change clears relevant state |
| TEN-01 | Implement organization/member/invitation lifecycle | Single-use invitations and final-owner/capacity races are deterministic |
| API-01 | Implement context/error/DTO/idempotency boundary | Direct API calls cannot bypass page checks; safe consistent errors |
| DOMAIN-01 | Build Project vertical slice by hand | Real mutation, permissions, audit/outbox, optimistic conflict, and list UI pass together |
| GEN-01 | Extract generator IR and templates from Project | Declared Project produces equivalent behavior and passes platform security tests |

Implement security primitives before generation. Add optional UI controls only after their server behavior exists. Do not ship visible placeholder enterprise settings that imply working protection.

## 6.4 Release checklist

### Security and identity

- [ ] All tenant tables carry the expected key, constraints, policies, and restricted-role coverage.
- [ ] List/read/write/count/search/file/export/job/API tests cover cross-tenant attacks and forged contexts.
- [ ] Direct grants, team grants, membership revocation, parent changes, and custom-role updates cannot use a stale graph.
- [ ] FGA/model/projection failures deny dependent access predictably and expose safe recovery diagnostics.
- [ ] MFA, session revocation, SSO enforcement, SCIM deprovisioning, key rotation, and last-owner transfer are tested.
- [ ] Required field-level restrictions, redaction, CSRF/origin/CORS policies, and operator boundaries are verified.

### Commercial correctness

- [ ] Fixed and seat subscriptions pass creation, upgrade, downgrade, renewal, delinquency, cancellation, and recovery scenarios.
- [ ] Duplicate/out-of-order/missed provider events converge to current state through replay and reconciliation.
- [ ] Plan entitlements, feature flags, permissions, hard quotas, and rate limits remain independent.
- [ ] Seat and quota concurrency tests prove capacity cannot be spent twice.
- [ ] Usage deduplication, corrections, period boundaries, job retry, and billing reconciliation are covered.
- [ ] Optional metered charging is labelled disabled unless a live-capable adapter has passed its separate contract tests.

### Generator and developer experience

- [ ] Generated feature migrates, builds, appears in navigation, and completes the dashboard/API workflow.
- [ ] Generated RLS/permissions/audit/DTO policies are enforced, including on manually invoked APIs.
- [ ] Regeneration is deterministic and preserves developer-owned files and historical migrations.
- [ ] Entity evolution handles data/backfill/API/model compatibility or refuses with a precise migration plan.
- [ ] Renaming a new product updates manifests, branding, package identifiers, emails, and example content.
- [ ] Template updates have a tested previous-release migration/codemod path.

### Operations and customer experience

- [ ] Local setup uses only synthetic data; production startup rejects missing/unsafe secrets and origins.
- [ ] Logs/metrics/traces, alerts, dead-letter views, and reconciliation runbooks are usable.
- [ ] The documented workload meets measured targets; permissions, exports, and tenant fairness are included.
- [ ] Backup restore meets measured recovery targets and reapplies deletion tombstones before serving traffic.
- [ ] Tenant export/deletion, provider cancellation, retention exceptions, and backup expiry are exercised.
- [ ] Dashboard forms/tables/dialogs pass keyboard/accessibility checks and display all failure states.
- [ ] Incident response, dependency updates, security contact, and deployment rollback/forward-fix ownership are assigned.

## 6.5 Configuration and adoption decisions

The plan can proceed with these defaults. Revisit the right-hand questions when implementing a product; they do not block creating this template plan.

| Topic | Template default | Product-specific decision |
| --- | --- | --- |
| Naming | `common-sass` | Name/branding/package namespace for each generated product |
| Tenant/billing boundary | One organization, one billing account | Consolidated billing across several organizations? |
| Content administration | Org admins manage all tenant content | Need private content hidden even from tenant administrators? |
| Guests | Explicit limited membership, disabled until E | Are guests billable and how long may grants last? |
| Hosting | Single-region portable containers, shared PostgreSQL | Cloud/region, residency, network controls, dedicated tenants |
| Authentication | Better Auth adapter; application-owned organization lifecycle | Identity vendor, self-service SSO licensing, supported IdPs |
| Pricing | Versioned free/trial/fixed/seat definitions | Price amounts, currencies, trial rules, seat classes, grace duration |
| Metered charges | Disabled; local ledger/quotas included | Provider, metric contracts, allowed overages, credits, hybrid charge ownership |
| Retention | Configurable by data class | Required audit/financial retention, deletion grace, contractual holds |
| Availability/scale | Reference targets in operations plan | Paid SLA, recovery commitments, target tenant/resource/event volume |
| Legal/compliance | Controls, evidence, and configuration hooks | Required agreements, certifications, regional obligations |

## 6.6 Risks and mitigation

| Risk | Mitigation and decision gate |
| --- | --- |
| Excessive scope makes the template hard to adopt | Modular presets; demonstrate F before C/E; optional extensions remain removable |
| Graph synchronization creates a stale-permission window | Authoritative PostgreSQL records, strict revision fence, higher-consistency checks, crash/revoke tests |
| Strict authorization fence increases tenant latency/unavailability | Short transactions, projection lag alerts, load benchmarks; optimize only with equivalent revocation guarantees |
| Identity plugin and application membership disagree | One documented source of truth; mapping/deprovisioning spike before organization implementation |
| Billing replay or ambiguous state creates bad access/charges | Durable commands/inbox, idempotency, serialized projection, independent reconciliation |
| Codegen destroys customization or history | Ownership manifest, staged diff, no edit of applied migrations, evolution/codemod tests |
| Shared database introduces noisy tenants | Tenant fairness, query/index budgets, separate worker pools, measured path to dedicated placement |
| Optional provider costs undermine a reusable template | Local fakes, adapters, optional modules, verified vendor terms; record operational cost categories |
| Generated features look complete but miss security | Required integration/security acceptance tests; no bypassable transport-only checks |

Track operational costs by database/backups, worker/FGA compute, object storage/egress, email, monitoring, identity services, and billing services. Establish budgets after selecting a deployment and expected usage; this plan does not assume current vendor prices.
