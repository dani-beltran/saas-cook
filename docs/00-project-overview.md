# 0. Project overview

An implementation plan for a reusable enterprise SaaS template built with **Next.js, React 19, TypeScript, shadcn/ui, Tailwind CSS, Better Auth, Drizzle ORM, PostgreSQL, and oRPC**, using **Bun** for package management and **Stripe** for payments and billing.

**Status:** planning only. The application, packages, migrations, agent skills, and lifecycle commands described here are proposed deliverables; they have not been implemented. Prepared on 2026-09-13; scope updated on 2026-09-19.

The folder name intentionally follows the requested spelling, `common-sass`. It lives inside the existing `common-saas` workspace.

## Read the plan

| Document | Contents |
| --- | --- |
| [1. Product plan](01-product-plan.md) | Scope, complete capability catalogue, product journeys, dashboard, and optional modules |
| [2. Architecture and security](02-architecture-and-security.md) | Stack, repository structure, tenant isolation, ReBAC, identity, API boundaries, and architectural decisions |
| [3. Data model](03-data-model.md) | Core tables, relationships, constraints, indexes, and database lifecycle |
| [4. Billing, usage, and operations](04-billing-usage-operations.md) | Monetization, entitlements, metering, audit, integrations, reliability, and data lifecycle |
| [5. AI agent skills](05-ai-agent-skills.md) | Planned skills, feature briefs, implementation/evolution workflows, deterministic checks, and behavioral evaluation |
| [6. Delivery roadmap](06-delivery-roadmap.md) | Dependencies, phases, effort assumptions, acceptance gates, and first implementation backlog |
| [7. CI/CD and deployment](07-ci-cd-and-deployment.md) | GitHub Actions pipelines, single-container Docker deployment, optional Kubernetes/Helm, image promotion, migrations, and rollback |
| [Example feature brief](../examples/features/project.md) | Concrete task and acceptance criteria for an agent building a Project feature |

## Recommended foundation

The [required stack in architecture §2.1](02-architecture-and-security.md#21-stack-decisions) is the canonical technology list. It also specifies next-intl, React Email, Zod, React Hook Form, Vitest, Playwright, Storybook, Biome, Commitlint, Lefthook, Knip, T3 Env, GitHub Actions, LogTape, and `AGENTS.md` for AI coding context. Phase 0 selects compatible versions of these technologies.

- A modular monolith with a Next.js application and a Node.js background worker, packaged together in one Docker container by default.
- Bun workspaces and a committed `bun.lock`; Node.js LTS runs the web application and worker.
- An organization is the tenant boundary; users can belong to several organizations.
- Shared PostgreSQL tables with tenant keys, tenant-aware constraints, and row-level security.
- OpenFGA for relationship-based permissions, subject to Phase 0 projection-safety and availability gates; authentication, permissions, paid entitlements, and quotas remain distinct.
- Drizzle ORM for database models and type-safe SQL; Drizzle Kit and reviewed SQL migrations.
- oRPC contracts and procedures in Next.js provide typed clients and public REST/OpenAPI exposure through shared domain services.
- GitHub Actions builds and publishes to GHCR, then promotes a verified image digest to a Docker host; Kubernetes with Helm is an optional deployment profile. PostgreSQL, OpenFGA, and object storage remain external services.
- Self-hosted Better Auth for authentication, including email magic links and passkeys, with enterprise identity integration behind adapters.
- Stripe for fixed and seat subscriptions; an independent usage ledger and an optional usage-billing adapter.
- Repository-local AI agent skills that build and evolve complete features using proven platform services: database changes, validation, services, permissions, APIs, dashboard, tests, and documentation. Deterministic tooling validates the result; there is no custom CRUD generator or entity DSL.
- Product analytics through a typed event catalogue and an optional provider adapter, separate from audit, observability, and billable usage.
- Self-service personal account deletion with accepted organization ownership transfers, credential revocation, resumable cleanup, and deletion-aware recovery.

## Delivery boundaries

**Foundation:** identity including magic links/passkeys, organizations and ownership transfer, tenant isolation, ReBAC, dashboard, durable jobs/audit/outbox, provider-independent entitlement and capacity primitives, service-account/API-key enforcement, one reference domain feature, and AI agent skills. A local policy catalogue makes this preset runnable without billing credentials.

**Commercial core:** subscriptions, provider-confirmed seat capacity, commercial entitlement sources, metered usage, product analytics, customer administration for audit/API keys, files, notifications, webhooks, personal account deletion, organization export/deletion, and a baseline recovery drill before accepting customer data.

**Enterprise release:** SSO, SCIM, custom roles, security policies, support access, advanced retention/legal holds, expanded recovery drills, and a tested upgrade path.

**Extensions:** Kubernetes/Helm deployment, dedicated tenant deployments, regional placement, complex metered contracts, custom domains, realtime collaboration, AI features, and industry-specific modules.

The template should be a strong base for many SaaS products. Each product still supplies its own domain rules, pricing, regulatory requirements, and capacity targets.

## Required design gates

- A late projector request must not restore revoked access after a worker loses its database lock. Phase 0 tests generation-isolated projection and hot-tenant availability before selecting the authorization protocol.
- Restores keep tenant traffic and workers gated until an independent deletion journal is replayed and the authorization graph is rebuilt and verified.
- Security deprovisioning takes precedence over last-owner protection; ownerless organizations enter an audited recovery state.
- Voluntary account deletion requires ownership resolution across all organizations and preserves continuing tenants and their subscriptions.
- Magic-link redemption and passkey recovery cannot bypass tenant SSO/MFA policies or reactivate a deleting account.
- Analytics cannot authorize or bill operations; disabled tracking and provider outages cannot block product use.
- File approval and downloads refer to the exact immutable bytes that passed scanning.
- Every transition into a billable membership uses the same transactional seat-admission boundary.

The [roadmap's capability-to-phase matrix](06-delivery-roadmap.md#capability-to-phase-and-acceptance-matrix) assigns these requirements and the skills' platform dependencies to explicit delivery gates. These safeguards are planned acceptance criteria, not implemented guarantees.
