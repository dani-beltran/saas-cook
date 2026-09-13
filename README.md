# common-sass

An implementation plan for a reusable enterprise SaaS template built with **Node.js, TypeScript, React, Next.js, shadcn/ui, and PostgreSQL**.

**Status:** planning only. The application, packages, migrations, and CLI commands described here are proposed deliverables; they have not been implemented. Prepared on 2026-09-13.

The folder name intentionally follows the requested spelling, `common-sass`. It lives inside the existing `common-saas` workspace.

## Read the plan

| Document | Contents |
| --- | --- |
| [1. Product plan](docs/01-product-plan.md) | Scope, complete capability catalogue, product journeys, dashboard, and optional modules |
| [2. Architecture and security](docs/02-architecture-and-security.md) | Stack, repository structure, tenant isolation, ReBAC, identity, API boundaries, and architectural decisions |
| [3. Data model](docs/03-data-model.md) | Core tables, relationships, constraints, indexes, and database lifecycle |
| [4. Billing, usage, and operations](docs/04-billing-usage-operations.md) | Monetization, entitlements, metering, audit, integrations, reliability, and data lifecycle |
| [5. Entity generator](docs/05-entity-generator.md) | Proposed scripts, declarative schema, generated artifacts, safe regeneration, and acceptance tests |
| [6. Delivery roadmap](docs/06-delivery-roadmap.md) | Dependencies, phases, effort assumptions, acceptance gates, and first implementation backlog |
| [Example entity specification](examples/entities/project.entity.yaml) | Concrete input contract for generating a Project feature |

## Recommended foundation

- A modular monolith with a Next.js application and a separate Node.js background worker.
- An organization is the tenant boundary; users can belong to several organizations.
- Shared PostgreSQL tables with tenant keys, tenant-aware constraints, and row-level security.
- OpenFGA for relationship-based permissions, subject to Phase 0 projection-safety and availability gates; authentication, permissions, paid entitlements, and quotas remain distinct.
- Drizzle for database models and reviewed SQL migrations.
- Better Auth for authentication, with enterprise identity integration behind adapters.
- Stripe for fixed and seat subscriptions; an independent usage ledger and an optional usage-billing adapter.
- A schema-driven CLI that creates a complete, secure feature: migration, model, validation, service, repository, permissions, API, dashboard, fixtures, tests, and documentation.

## Delivery boundaries

**Foundation:** identity, organizations, tenant isolation, ReBAC, dashboard, durable jobs/audit/outbox, provider-independent entitlement and capacity primitives, service-account/API-key enforcement, one reference domain feature, and the generator. A local policy catalogue makes this preset runnable without billing credentials.

**Commercial core:** subscriptions, provider-confirmed seat capacity, commercial entitlement sources, metered usage, customer administration for audit/API keys, files, notifications, webhooks, organization export/deletion, and a baseline recovery drill before accepting customer data.

**Enterprise release:** SSO, SCIM, custom roles, security policies, support access, advanced retention/legal holds, expanded recovery drills, and a tested upgrade path.

**Extensions:** dedicated tenant deployments, regional placement, complex metered contracts, custom domains, realtime collaboration, AI features, and industry-specific modules.

The template should be a strong base for many SaaS products. Each product still supplies its own domain rules, pricing, regulatory requirements, and capacity targets.

## Required design gates

- A late projector request must not restore revoked access after a worker loses its database lock. Phase 0 tests generation-isolated projection and hot-tenant availability before selecting the authorization protocol.
- Restores keep tenant traffic and workers gated until an independent deletion journal is replayed and the authorization graph is rebuilt and verified.
- Security deprovisioning takes precedence over last-owner protection; ownerless organizations enter an audited recovery state.
- File approval and downloads refer to the exact immutable bytes that passed scanning.
- Every transition into a billable membership uses the same transactional seat-admission boundary.

The [roadmap's capability-to-phase matrix](docs/06-delivery-roadmap.md#capability-to-phase-and-acceptance-matrix) assigns these requirements and the generator's dependencies to explicit delivery gates. These safeguards are planned acceptance criteria, not implemented guarantees.
