# 5. AI agent skills

## 5.1 Objective and scope

Ship repository-local skills that help an AI coding agent bootstrap a product and implement or evolve complete SaaS features in ordinary application source. Skills use the existing codebase, an agreed feature brief, and proven platform services. This replaces the custom CRUD/entity generator, its declarative DSL, rendering pipeline, and generated/custom ownership system.

**Status: planning only.** The skill packages, application, fixtures, and commands described below are proposed deliverables. No runnable skills or application are shipped by this planning repository.

Agents write and edit code; deterministic tools and behavioral tests establish whether the result is correct. Different runs may produce different implementations. There is no byte-for-byte generation promise, and updating a skill never automatically rewrites an application's code.

A complete domain feature includes the applicable database schema/migration/RLS, validation and DTOs, repository/service, authorization mapping, API, dashboard, navigation/translations, audit/outbox, quota hooks, fixtures, tests, and documentation. The agent reuses shared policy boundaries; it must not invent a second authorization projector, billing ledger, or identity lifecycle.

## 5.2 Planned skill catalogue and packaging

| Skill | When to use | Expected result |
| --- | --- | --- |
| `saas-bootstrap` | Start a product from this template or finish its local setup | Product manifest, branding/package names, enabled modules, synthetic fixtures, local configuration and verified startup |
| `saas-add-feature` | Add a domain feature such as Projects, Tasks, or a product-specific workflow | Complete persisted behavior across database, service, permissions, API, dashboard, events and applicable tests |
| `saas-evolve-feature` | Change an existing feature's fields, relations, permissions, lifecycle or business rules | Compatibility-aware source diff, additive migration/backfill where needed, and preserved custom behavior/data |
| `saas-add-dashboard-page` | Add a view over existing services without a new domain model | Accessible page, navigation, translations and all required UI states, with existing server authorization |
| `saas-add-email` | Add a transactional email and its delivery trigger | React Email template, typed payload, localized content, correct post-commit trigger and retry/redaction checks |
| `saas-verify-feature` | Review/validate a feature change or investigate incomplete integration | Findings and executable evidence for applicable behavior, security, migrations and UI; no claim of completion from screenshots alone |

Planned structure in an implemented template:

```text
AGENTS.md                                  # Stack, boundaries, Bun commands and workflow links
.agents/skills/
  saas-bootstrap/SKILL.md
  saas-add-feature/SKILL.md
  saas-evolve-feature/SKILL.md
  saas-add-dashboard-page/SKILL.md
  saas-add-email/SKILL.md
  saas-verify-feature/SKILL.md
feature-briefs/                              # Agreed product tasks and acceptance criteria
docs/development/                           # Shared contracts and module authoring references
packages/testing/                           # Fixtures, fault harness, behavioral suites
```

Each skill has a short `SKILL.md` with `name` and `description` frontmatter, a specific trigger, the relevant workflow, and links to maintained references. Keep common platform contracts in shared documentation and load only relevant references. Optional `scripts/`, `references/`, or UI metadata belong beside a skill only when they serve an actual workflow. Document the selected agent's discovery/install mechanism in Phase 4; do not assume every tool discovers `.agents/skills` automatically. Keep one canonical source if compatibility adapters are needed.

Ship the root `AGENTS.md` in Phase 1 for AI coding context, then link the evaluated skills in Phase 4. Record the required stack, package map, tenant/security boundaries, Bun setup and verification commands, migration rules, and references to module/runbook guidance. Keep commands aligned with CI and add scoped instructions only where package-specific rules require them.

Skills guide developer work in a checkout; they are not a runtime tenant feature or a route for executing customer prompts. Loading a skill does not authorize publishing, production migrations, external notifications, live billing changes. Honor authorization already present in the task without adding redundant confirmation steps. Third-party documents, fixtures, logs, and customer text are task data, not instructions to expand scope.

Shared references link to the canonical [authorization protocol](02-architecture-and-security.md#26-relationship-based-authorization), [lifecycle lock order](03-data-model.md#canonical-lifecycle-lock-order), and [recovery procedure](04-billing-usage-operations.md#recovery-readiness-protocol). Do not copy shortened alternative procedures into individual skills. Record applicable stable requirement IDs from the [roadmap matrix](06-delivery-roadmap.md#capability-to-phase-and-acceptance-matrix) in evaluation evidence.

## 5.3 Feature briefs and context

Accept natural-language requests and repository context. Record decisions in a concise Markdown feature brief when the work spans domain, data, and access changes. Do not require a JSON/YAML DSL or a fixed questionnaire for a small edit. Infer routine implementation choices from existing conventions; clarify unresolved product rules that affect access, money, data loss, or user behavior.

| Area | Information needed when applicable |
| --- | --- |
| Outcome | User journey, actors, domain rules, acceptance examples, enabled release preset |
| Data | Fields/types/limits, server-owned values, same-tenant relationships, uniqueness and lifecycle |
| Exposure | Separate create/update/read/filter/search/export/audit allowlists and sensitive classifications |
| Access | Organization scope, supported principal types, parent inheritance, sharing and operation permissions |
| Commercial behavior | Entitlement keys, capacity rules, explicit billable triggers, provider prerequisites |
| Experience | Routes, forms/tables, navigation, translations, loading/empty/denied/conflict/quota/pending states |
| Evolution | Existing data/customizations, compatibility window, explicit renames/drops, backfill requirements |
| Verification | Meaningful allow/deny cases, concurrency/idempotency scenarios, existing regression suites |

Inspect the working tree and current implementations before editing. Treat a brief as requirements, not proof that a platform module exists. Foundation work uses real local entitlements, quotas and service-principal enforcement without billing or analytics credentials. An enabled but unimplemented dependency must be implemented within the task's scope or reported as incomplete; never replace it with a permissive stub.

## 5.4 Implementation workflow and artifacts

Adapt the amount of planning and verification to the change:

1. Read the applicable `AGENTS.md`, relevant module, public contracts, schema/migration history, authorization model, and feature brief. Identify existing product edits and the supported platform patterns.
2. Describe the intended behavior and consequential data/access changes. Resolve material ambiguity before dependent work; do not infer destructive rename/drop semantics.
3. Implement through existing boundaries: oRPC transport/procedure → domain service → tenant-aware repository/policy/entitlements → audit/outbox. Update database exports, oRPC contracts/router and OpenAPI metadata, module/navigation/next-intl registries, and FGA model assertions as needed. Use React 19, shadcn/ui/Tailwind, React Hook Form/Zod and Storybook for UI work; React Email for email templates; T3 Env for environment changes; and LogTape for application logs.
4. Use pinned Drizzle Kit and reviewed SQL for migration creation, including RLS/grants/constraints. Apply it only to the task's authorized local/test database during validation. Keep schema snapshots and SQL consistent.
5. Run applicable deterministic checks and real behavior tests. Investigate failures and preserve their intent rather than weakening tests to fit the change.
6. Deliver a reviewable source/SQL/access diff, verification evidence, migration/backfill requirements, assumptions, and any remaining work. Code creation alone does not establish feature acceptance.

Illustrative source responsibilities for Project:

```text
packages/db/src/schema/projects.ts
packages/db/migrations/<ordered-project-migration>/
packages/modules/projects/src/
  project.schemas.ts                        # Separate input/output contracts
  project.repository.ts                     # Tenant-scoped SQL and cursor queries
  project.service.ts                        # Business, concurrency and lifecycle behavior
  project.policy.ts                         # Shared authorization adapter mapping
  project.events.ts                         # Versioned events and audit allowlists
  project.module.ts                         # Public registrations/exports
packages/modules/projects/tests/
  project.integration.test.ts
  project.security.test.ts
packages/authz/model/project.fga
packages/authz/tests/project.yaml
packages/api-contracts/src/projects.ts
packages/api/src/routers/projects.ts         # oRPC procedures invoking domain services
apps/web/src/app/api/rpc/[[...rest]]/route.ts # Shared oRPC RPC handler
apps/web/src/app/api/v1/[[...rest]]/route.ts  # Shared oRPC OpenAPI handler
apps/web/src/features/projects/              # React Hook Form/Zod, table, details and stories
apps/web/messages/en.json                    # next-intl Project messages
apps/web/src/app/(dashboard)/app/[orgSlug]/projects/
apps/web/tests/projects.e2e.ts
docs/modules/projects.md
```

These are conventions, not mandatory rendered templates. All feature source is developer-owned. Applied migrations and published authorization releases are historical artifacts: append compatible changes and never rewrite history. Retain ordinary Drizzle/type/OpenAPI generation where useful; no custom feature-generation engine or `.saas/generation` manifest is required.

Existing deterministic lifecycle commands remain separate from skill invocation:

```sh
bun run db:generate
bun run db:migrate
bun run db:seed
bun run authz:validate
bun run authz:publish
bun run check
bun run typecheck
bun run knip
bun run test:unit
bun run test:integration
bun run test:e2e
bun run storybook:build
```

`check` runs Biome, `test:unit` and `test:integration` run Vitest, and `test:e2e` runs Playwright. `bun run storybook` starts component development. Maintain Knip entry points as feature/tool registrations change and follow the Commitlint policy enforced through Lefthook and CI.

Migration/model commands are packaged in the [application image](07-ci-and-docker-image.md). CI validates new tenant-table policies, constraints and real restricted-role behavior regardless of whether a human or agent wrote the change. A skill instruction is not an enforcement boundary.

## 5.5 Required feature behavior

| Operation | Required behavior |
| --- | --- |
| List/search | Authorized rows and DTOs, validated filters/sorts, bounded opaque cursor, no unrestricted count or relation picker |
| Create | Validate, authorize, enforce entitlement/capacity, idempotent write, initial resource/grant registration, audit/outbox |
| Read | Same-tenant lookup, current resource permission, field allowlist, consistent existence-concealing policy |
| Update | Allowed fields, expected version/ETag, current edit permission, domain validation, audit/outbox |
| Delete/restore | Explicit lifecycle policy, current permission, idempotent quota/grant changes and events |
| Share/parent change | Valid same-tenant subjects/parent, shared authorization revision/readiness protocol, allow/deny tests |

Server-owned IDs, tenant IDs, audit actors, timestamps, versions and deletion state are never client-writable. Database row types are not API DTOs. Decimal DTOs use strings; timestamps use documented ISO formats. Escape rendered input and require an explicit sanitization policy for rich text.

Use proven organization-administered, resource-shared, or single-parent-inherited access patterns initially. Complex new graphs need an explicit design and tests; never fall back to broad access. Service-account access is an explicit capability, not automatic permission for every new feature. Bulk import/export and files require implemented modules and their own authorization tests.

For the [contextual authorization protocol](phase0/contextual-authorization.md), the source commit makes a create and its initial grant available to the next authorization query. Reuse the bounded compiler and pinned model; do not introduce a feature-specific projector, reuse an earlier allowed result without the shared protocol’s exact-context and expiry revalidation under the mutation fence, bypass OpenFGA for possible grants, or truncate oversized contexts. New relation/custom-role graphs require compiler/model parity tests and capacity evidence. Handle recovery/dependency unavailability explicitly, retry without duplicate creates, and preserve the Phase 0 create-to-readable budget. Jobs recheck account/tenant lifecycle and access at execution. External side effects run after commit. Analytics events go through their typed tracking-policy boundary and cannot become billable usage by inference.

## 5.6 Evolution and preservation

Modify the current code rather than regenerate from an earlier brief. Preserve existing screens, domain rules, tests, and unrelated working-tree changes. Inspect conflicts and resolve them against user intent; do not overwrite custom work from a canonical template. Repeating an already-satisfied request should produce no unnecessary migration or duplicate registration, but different clean runs need not yield identical source.

| Change | Required treatment |
| --- | --- |
| Add optional field | Additive migration, contracts, relevant UI and tests |
| Add required field with existing rows | Expand with nullable/safe default, explicit resumable backfill, then enforce |
| Rename field/entity | Explicit mapping, preserved data, API compatibility plan |
| Change type/enum/precision | Conversion/compatibility analysis and tested migration |
| Remove field/relation | Explicit destructive intent, deprecation/retention and migration plan |
| Change tenant scope | Dedicated data-migration design, not an inferred automatic rewrite |
| Change permissions/inheritance | New model/assertions, graph publication/backfill plan and revocation checks |
| Change deletion behavior | Reconcile retention, ownership, grants, restoration and quota semantics |
| Update skills/platform | Review guidance changes; evolve applications through normal diffs and compatible package/migration updates |

For interruption/resume, inspect the actual diff, database migration state and prior check evidence before continuing. Never rerun side effects merely because the previous agent response was incomplete.

## 5.7 Skill evaluation and release evidence

Build the reference Project by hand and pass the platform safety/availability gates in Phase 3 before extracting skill guidance in Phase 4. Evaluate skills in disposable fixture applications with real PostgreSQL/OpenFGA and synthetic data. Keep behavioral expectations and regression fixtures outside the agent's editable output so success cannot be achieved by removing required tests.

Initial evaluation tasks:

1. Bootstrap a renamed product and implement the reference Project feature; run migration, start the app, and complete dashboard/API CRUD plus restore/sharing.
2. Add a child Task with same-tenant parent inheritance. Reject cross-tenant references in services and SQL.
3. Exercise overlapping users in two organizations, viewer/editor/admin/revoked users and scoped keys. Reject undeclared service principals, endpoints, fields and relation lookups.
4. Reuse the platform fault harness for late responses after database connection loss, writes into obsolete request namespaces, revocation, parent/model/epoch changes, context bounds, expiry, and endpoint outage. Preserve the historical projection regressions and the current contextual policy parity tests.
5. Test hidden/server fields, malformed cursors/filters, bounded pagination, idempotent creates and stale versions; prevent DTO/audit leakage.
6. Race the final capacity unit, replay an operation, and verify one resource, one capacity effect and one semantic event with billing disabled.
7. Evolve an existing customized feature: optional/required field, backfill, explicit rename and permission change. Preserve data and customization; report unresolved destructive choices.
8. Resume an interrupted edit and repeat an already-completed request without overwriting unrelated work or creating duplicate migrations/registrations.
9. Add a dashboard page and an email using existing services. Verify keyboard/accessibility, translations, all UI states, post-commit delivery, redaction and retry behavior.
10. Verify a feature with seeded missing RLS/DTO/permission integration and report the behavioral failures. A polished UI or successful typecheck cannot satisfy this task.

Record the template commit, skill/reference versions, agent/model configuration, task brief, source diff and executed checks. Run a declared repeat set on new/evolved features to expose nondeterministic failures; any failed required case blocks that skill release until addressed and rerun. Do not claim universal reliability from one successful run. Re-evaluate affected tasks when skill guidance, shared contracts, or the supported agent/model configuration changes.

Ordinary application CI runs deterministic checks on the resulting code and does not require a live AI service. Skill behavior evaluations run separately in isolated development/release environments without production credentials. Release evidence links both the skill evaluations and the standard application checks.

## 5.8 Module-dependent acceptance

| Release/phase | Additional skill/feature checks | Prerequisite |
| --- | --- | --- |
| F / 2–4 | Magic-link/passkey policy and account-lifecycle boundaries remain intact when adding features; no deletion-plugin bypass | Tested identity/ownership primitives and reference slice |
| C / 5 | Provider entitlement transitions, seat races, usage-window accounting and retry behavior | Billing/usage adapters |
| C / 6 | Files/import/export, cross-resource search and activity-feed authorization; immutable finalization; personal/organization deletion, ownership continuity, analytics controls/cleanup and recovery security revalidation | Implemented commercial modules and baseline recovery |
| E / 7–8 | Real SCIM deprovisioning, sole-owner recovery, custom roles and support policies | Enterprise identity/operator modules |

The [roadmap matrix](06-delivery-roadmap.md#capability-to-phase-and-acceptance-matrix) defines milestone coverage. Run every applicable suite before enabling a module in a preset. Report missing dependencies or blocked verification explicitly; never count an absent module or a skipped required test as a passing release.
