# 0. Project overview

## Backoffice first-slice extension

The customer deployment retains its combined web/worker image. The optional [Backoffice first slice](backoffice/implementation.md) adds an independently built private staff application/image; its implementation and release evidence are tracked separately from customer milestones.

An implementation plan for a reusable enterprise SaaS template built with **Next.js, React 19, TypeScript, shadcn/ui, Tailwind CSS, Better Auth, Drizzle ORM, PostgreSQL, and oRPC**, using **Bun** for package management and **Stripe** for payments and billing.

**Status:** Phase 0 validation and Phase 1 repository/runtime implementation are complete for their documented scope. The [Phase 1 guide](phase1/README.md) covers the runnable shell, worker, API skeleton, combined image and local acceptance evidence. Identity, tenant access and production authorization are Phase 2 work.

The project is named **SaaS Cook**, with root package `saas-cook` and workspace package namespace `@saas-cook`. See the [compatibility notes](#compatibility-identifiers) for retained compatibility identifiers.

## Read the plan

| Document | Contents |
| --- | --- |
| [Phase 1 runtime](phase1/README.md) | Local setup, implemented packages, verification commands and acceptance evidence |
| [Phase 0 validation](phase0/README.md) | Executable experiments, decision records, measured results and remaining exit gates |
| [1. Product plan](01-product-plan.md) | Scope, complete capability catalogue, product journeys, dashboard, and optional modules |
| [2. Architecture and security](02-architecture-and-security.md) | Stack, repository structure, tenant isolation, ReBAC, identity, API boundaries, and architectural decisions |
| [3. Data model](03-data-model.md) | Core tables, relationships, constraints, indexes, and database lifecycle |
| [4. Billing, usage, and operations](04-billing-usage-operations.md) | Monetization, entitlements, metering, audit, integrations, reliability, and data lifecycle |
| [5. AI agent skills](05-ai-agent-skills.md) | Planned skills, feature briefs, implementation/evolution workflows, deterministic checks, and behavioral evaluation |
| [6. Delivery roadmap](06-delivery-roadmap.md) | Dependencies, phases, effort assumptions, acceptance gates, and first implementation backlog |
| [7. CI and Docker image build](07-ci-and-docker-image.md) | Source checks, image contents, reproducible Docker builds and image verification |

## Recommended foundation

The [required stack in architecture §2.1](02-architecture-and-security.md#21-stack-decisions) is the canonical technology list. It also specifies next-intl, React Email, Zod, React Hook Form, Vitest, Playwright, Storybook, Biome, Commitlint, Lefthook, Knip, T3 Env, GitHub Actions, LogTape, and `AGENTS.md` for AI coding context. Phase 0 selects compatible versions of these technologies.

- A modular monolith with a Next.js application and a Node.js background worker, packaged together in one Docker container by default.
- Bun workspaces and a committed `bun.lock`; Node.js LTS runs the web application and worker.
- An organization is the tenant boundary; users can belong to several organizations.
- Shared PostgreSQL tables with tenant keys, tenant-aware constraints, and row-level security.
- OpenFGA for relationship-based permissions, subject to Phase 0 projection-safety and availability gates; authentication, permissions, paid entitlements, and quotas remain distinct.
- Drizzle ORM for database models and type-safe SQL; Drizzle Kit and reviewed SQL migrations.
- oRPC contracts and procedures in Next.js provide typed clients and public REST/OpenAPI exposure through shared domain services.
- GitHub Actions checks source and builds the combined Docker image. PostgreSQL, OpenFGA and object storage remain external services.
- Self-hosted Better Auth for authentication, including email/password, email magic links and passkeys, with enterprise identity integration behind adapters.
- Stripe for fixed and seat subscriptions; an independent usage ledger and an optional usage-billing adapter.
- Repository-local AI agent skills that build and evolve complete features using proven platform services: database changes, validation, services, permissions, APIs, dashboard, tests, and documentation. Deterministic tooling validates the result; there is no custom CRUD generator or entity DSL.
- Product analytics through a typed event catalogue and an optional provider adapter, separate from audit, observability, and billable usage.
- Self-service personal account deletion with accepted organization ownership transfers, credential revocation, resumable cleanup, and deletion-aware recovery.

## Delivery boundaries

**Foundation:** identity including email/password registration and reset, magic links/passkeys and MFA recovery, organizations and ownership transfer, tenant isolation, ReBAC, dashboard, durable jobs/audit/outbox, provider-independent entitlement and capacity primitives, service-account/API-key enforcement, one reference domain feature, and AI agent skills. A local policy catalogue makes this preset runnable without billing credentials.

**Commercial core:** subscriptions, provider-confirmed seat capacity, commercial entitlement sources, metered usage, product analytics, customer administration for audit/API keys, files, notifications, webhooks, personal account deletion, organization export/deletion, and baseline application recovery tests.

**Enterprise release:** SSO, SCIM, custom roles, security policies, support access, advanced retention/legal holds, expanded recovery drills, and a tested upgrade path.

**Extensions:** Complex metered contracts, custom domains, realtime collaboration, AI features, and industry-specific modules.

The template should be a strong base for many SaaS products. Each product still supplies its own domain rules, pricing, regulatory requirements, and capacity targets.

## Required design gates

- A late projector request must not restore revoked access after a worker loses its database lock. Phase 0 tests generation-isolated projection and hot-tenant availability before selecting the authorization protocol.
- Restores follow the [canonical recovery procedure](04-billing-usage-operations.md#recovery-readiness-protocol): journal replay, independent security revalidation after an application restore, and verified graph reconstruction gate resumed access. A graph rebuilt from old permissions does not preserve later revocations by itself.
- Security deprovisioning takes precedence over last-owner protection; ownerless organizations enter an audited recovery state.
- Voluntary account deletion requires ownership resolution across all organizations and preserves continuing tenants and their subscriptions.
- Magic-link redemption and passkey recovery cannot bypass tenant SSO/MFA policies or reactivate a deleting account.
- Analytics cannot authorize or bill operations; disabled tracking and provider outages cannot block product use.
- File approval and downloads refer to the exact immutable bytes that passed scanning.
- Every transition into a billable membership uses the same transactional seat-admission boundary.

The [roadmap's capability-to-phase matrix](06-delivery-roadmap.md#capability-to-phase-and-acceptance-matrix) assigns these requirements and the skills' platform dependencies to explicit delivery gates. These safeguards are planned acceptance criteria, not implemented guarantees.

## Compatibility identifiers

Active packages use `@saas-cook`; PostgreSQL roles use `saas_cook` under the one-time disposable reset documented in the [migration guide](../packages/db/migrations/README.md). Preserve the `x-common-saas-source*` ingress headers and `common-saas-ingress:v1` signing domain as protocol identifiers. Retained Phase 0 fixtures, package names and acceptance evidence remain historical contracts. A product rename does not authorize changing deployed database roles, signed protocol identifiers or applied migrations.
