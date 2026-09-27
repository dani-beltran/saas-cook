# A junior developer’s guide to common-sass

This guide explains what we are building, what its features mean, and the order in which we plan to implement them. It summarizes the repository’s design documents as of **23 September 2026**. The [delivery roadmap](06-delivery-roadmap.md) owns the detailed acceptance criteria; this guide is an introduction.

## 1. What is this project?

**common-sass is a reusable starting point for business SaaS products.** SaaS means “software as a service”: an application customers use online, often through a subscription. The repository lives in the `common-saas` directory; its package and planning documents use the name `common-sass`.

Many products need the same supporting features: sign-in, company accounts, permissions, billing, dashboards, email, and background processing. This template will provide that shared foundation. A team adopting it will own the source code and add its own branding, pricing, business rules, and product features.

For example, a team building a client project tracker could reuse organization membership, invitations, permissions, and subscriptions, then implement its own project approval workflow. The template includes a demonstration **Projects** feature to prove how the pieces fit together. Products that do not need it can remove it.

## 2. What exists today?

**This repository now has a runnable Phase 1 foundation. Identity, tenant access and product features are still under development.** A *spike* is a small experiment used to test a technical decision before committing to the full implementation.

| Area | Current state |
| --- | --- |
| Product and technical plans | Written in `docs/`, including security, data, billing, delivery and Docker image plans |
| Phase 0 experiments | Code, fixtures, tests, decision records, and retained results exist under `spikes/phase0/` and `docs/phase0/` |
| Next.js/API example | Demonstrates contracts and request handling with synthetic authentication and in-memory Project data |
| Database and identity experiments | Exercise specific integration and security assumptions; they do not provide the complete production lifecycle |
| Authorization design | Contextual replacement passed the Phase 0 gate; production integration remains planned |
| Application runtime and reusable packages | Phase 1 shell, worker, API skeleton, shared packages, local services and combined image are implemented |
| Repository-local SaaS agent skills | Planned; the skill catalogue is a design document |

The original authorization experiment copied permission relationships into snapshots and failed its availability/storage gate. Its contextual replacement builds bounded permission inputs from current database state and passed the full reference benchmark. Historical failures remain documented.

The next step is Phase 2 identity, tenancy and production authorization. See the [Phase 1 setup and acceptance guide](phase1/README.md) for the runnable application and the [Phase 0 results](phase0/README.md) for earlier design evidence.

## 3. The concepts you need first

Imagine two customers, **Acme** and **Orbit**, using the same application. Alice belongs to both, but can edit Projects only at Acme.

| Concept | Plain-language meaning | Example |
| --- | --- | --- |
| Organization / tenant | A customer boundary that owns its data; initially also its billing account | Acme’s Projects belong to Acme |
| User and membership | A user is a global account; a membership connects that user to one organization | Alice has separate memberships in Acme and Orbit |
| Authentication | Establishing who is making a request | Alice signs in with a passkey |
| Authorization | Deciding whether that identity may perform an action on a resource | Alice may edit Acme’s Project but only view Orbit’s |
| ReBAC | Relationship-based access control: permissions come from relationships among users, teams, and resources | Membership in a team can grant access to its Projects |
| Entitlement | A capability available under the organization’s policy or plan | Acme’s plan enables a feature |
| Quota / capacity | A limit on how much an organization may use or create | Acme can create at most a configured number of Projects |
| Seat | A membership that counts toward a configured user allowance | An accepted invitation may consume a seat |
| Tenant isolation | Keeping one customer’s data inaccessible to another customer | Changing a URL cannot expose Orbit’s records to an Acme-only user |

These checks answer different questions. A signed-in user still needs permission. Permission does not override a plan limit. Paying for a feature does not grant access to another customer’s data. Hiding a button is useful UI behavior, but the server must enforce every applicable rule.

## 4. What features will the template provide?

The plan groups delivery into three milestones. Features in this section are **planned**, even where Phase 0 already contains a related experiment.

| Milestone | Main features | What it enables |
| --- | --- | --- |
| **Foundation — phases 0–4** | Email/password registration, sign-in and reset; magic links, passkeys, multi-factor authentication and recovery, sessions; organizations, invitations, teams and accepted ownership transfers; tenant isolation and resource permissions; dashboard and Projects; durable jobs and security audit; local entitlements/quotas; service accounts and API-key enforcement; evaluated AI development skills | A reusable base with one complete example feature, usable without billing credentials |
| **Commercial core — through phase 6** | Stripe subscriptions and seat billing; usage metering and dashboards; files, imports/exports, notifications and webhooks; customer API-key and audit interfaces; cross-resource search and activity feeds; product analytics; personal account and organization deletion; application recovery tests | Common paid-product workflows, after application acceptance gates pass |
| **Enterprise baseline — through phase 8** | Enterprise single sign-on, directory provisioning, custom roles, guests, security policies, contract overrides, controlled support access, retention/legal-hold hooks, and expanded performance/recovery/upgrade validation | A template ready for the tested enterprise scope |

Single sign-on (**SSO**) lets a customer use its company identity provider. **SCIM** is a standard for synchronizing users and groups from that provider. Both require real integration and deprovisioning tests before being presented as working features.

Complex usage charging, custom domains, realtime collaboration, and product AI features are optional extensions outside the required baseline.

Several features need care beyond their visible screens:

- **Ownership and deletion:** a user closing their global account must resolve ownership in every organization. Continuing customers keep their organizations, resources, and subscriptions. Security offboarding must still revoke a sole owner’s access and enter a controlled recovery state.
- **Billing and usage:** repeated or delayed payment notifications must not create duplicate charges or incorrect access. Product analytics measures adoption; a separate usage ledger records billable activity.
- **Files:** downloads must serve the exact immutable bytes that passed scanning. Replacing an object after approval must not bypass that check.
- **Recovery:** restoring a database must not revive deleted accounts or old permissions. Recovery includes independent security revalidation before access resumes.
- **Dashboard:** loading, empty, denied, quota, conflict, and failure states are part of the feature, alongside keyboard accessibility, translations, and themes.

The [product plan](01-product-plan.md) contains the full capability catalogue and user journeys.

## 5. How the application will fit together

The architecture is a **modular monolith**: one application organized into modules with clear responsibilities. The Phase 1 Docker image contains its web server and background worker. PostgreSQL, the authorization service, and object storage run externally. The contextual authorization prototype passed Phase 0; production integration remains planned.

| Layer | Main tools | Responsibility |
| --- | --- | --- |
| Pages and components | Next.js, React 19, shadcn/ui, Tailwind CSS | Render pages and interactive controls |
| Forms and localization | React Hook Form, Zod, next-intl | Collect input, describe validation rules, translate and format content |
| API boundary | oRPC and Zod | Validate requests and expose typed clients plus REST/OpenAPI access |
| Domain services | TypeScript modules | Coordinate permissions, business rules, capacity, and data changes |
| Identity and permissions | Better Auth; proposed OpenFGA integration | Verify identities and enforce allowed resource actions |
| Persistence | PostgreSQL and Drizzle | Store records, apply constraints, and execute transactions |
| Background work | Node.js worker, pg-boss | Process durable jobs, events, retries, and provider interactions |
| Provider integrations | Stripe, React Email with a delivery adapter, private object storage, optional analytics adapter | Connect platform workflows to external services |
| Build and runtime | Bun workspaces, Turborepo, Node.js | Bun manages packages/scripts; Node.js runs the application and worker |

A **domain service** owns an operation such as “create a Project.” A **repository** owns the SQL for reading and writing its records. API handlers and pages reuse services so that business rules stay consistent across entry points. PostgreSQL **row-level security (RLS)** adds a database restriction on which tenant’s rows a connection may access.

For an interactive client, the conceptual path is:

```text
React form → oRPC request → domain service → tenant-aware repository → PostgreSQL
                                  ↓
                      identity, permission and capacity checks

Committed outbox records → background worker → provider operations and retries
```

Server-rendered components can call services directly. They do not need to send HTTP requests back into their own application. The diagram describes responsibilities, not an implementation-level locking or authorization algorithm; those contracts live in the [architecture](02-architecture-and-security.md) and [data model](03-data-model.md).

An **outbox** stores work to deliver later in the same transaction as the business change. This prevents a saved Project from losing its associated event if a process crashes. **Idempotency** means retrying the same logical operation does not apply its effect twice. These patterns matter because network calls and jobs can be retried.

## 6. The implementation plan

A phase is complete when its **exit gate** passes: the required evidence that its behavior works. Writing the code or displaying a settings page is not enough.

| Phase | Build or prove | Why it comes here / completion evidence |
| --- | --- | --- |
| **0. Validate decisions — complete** | Stack compatibility, identity/database/provider experiments, authorization correctness/performance and application recovery contracts | Synthetic gate passed; application implementation follows |
| **1. Repository and runtime** | Workspace layout, UI shell, worker, configuration, local services, CI, logging and Docker image | A clean checkout builds reproducibly; image checks pass with synthetic data |
| **2. Identity, tenancy, and authorization** | Real sign-in/security flows, organizations and memberships, invitations/teams, ownership transfer, tenant-aware transactions, selected permission protocol, audit/outbox, and local seat policies | Real services prove isolation, revocation, ownership, recovery boundaries, and race safety |
| **3. Projects vertical slice** | Complete Project create/read/update/delete flow, resource permissions, service identities, quotas, API contracts, pagination, search, and dashboard | One real feature works across all layers, with consistent checks through both API transports |
| **4. AI development skills** | Skills for bootstrap, add/evolve/verify feature, dashboard pages, and emails | Repeated evaluations prove they reuse the working platform and preserve custom code, existing data, and migration history |
| **5. Monetization** | Plans, Stripe Checkout/portal, fixed and seat subscriptions, usage ledger, commercial entitlement sources, and reconciliation | Duplicate, missing, and out-of-order provider events converge to correct state |
| **6. Commercial modules and recovery** | Files/search/activity, notifications/integrations, analytics, data export/deletion and application recovery tests | Applicable module and recovery suites pass |
| **7. Enterprise administration** | SSO, SCIM, custom roles, security policies, guest/support workflows, and retention controls | Real identity-provider flows enforce organization-scoped access and audited administration |
| **8. Hardening and release** | Performance/failure testing, accessibility, application recovery tests and image verification | Applicable application and image acceptance gates pass |

A **vertical slice** is a small feature implemented all the way from its screen to its database and tests. Proving Projects first gives later modules—and the planned AI skills—a concrete pattern to reuse.

The original estimate of **34–55 engineer-weeks**, plus **2–4** for recovery, predates the image-only scope and validated authorization replacement. These figures need revision before use as a delivery schedule. An engineer-week is one engineer’s week of effort. See the [roadmap](06-delivery-roadmap.md).

## 7. Example: implementing “Create Project”

After the platform prerequisites pass, a complete feature should follow this workflow:

1. **Describe behavior.** Decide who may create a Project, which fields are editable, which organization owns it and what limit applies. Define successful and rejected cases.
2. **Design persistence.** Add the schema and a reviewed migration, including tenant-aware relationships, constraints, indexes, and RLS. A migration is a versioned database change; preserve previously applied migration history.
3. **Define input and output.** Use Zod contracts for accepted values and an explicit response object. This response is a **DTO** (data transfer object): only the fields the client is allowed to receive.
4. **Implement the shared service.** Use trusted identity and tenant context, existing permission/lifecycle boundaries, and transactional capacity checks. Persist the Project and required audit/outbox records atomically. A transaction makes the grouped database changes succeed or fail together.
5. **Expose the operation.** Connect the service to the shared API contracts and handlers. Reuse the same checks for supported human and service-account callers.
6. **Build the experience.** Add the form, navigation, translated labels, and meaningful validation/denied/quota/pending/error states. Follow the selected authorization readiness contract before presenting a new resource as usable.
7. **Prove the behavior.** Test allowed creation, cross-tenant denial, missing permission, exhausted capacity, concurrent requests for the final slot, retries, and the browser journey. Update feature documentation.

For example, if Acme has room for one more Project and two requests arrive together, at most one should consume that slot. A browser-only quota check cannot enforce this; the server and database must coordinate it.

## 8. How to explore the repository now

| Location | What to inspect |
| --- | --- |
| [`docs/phase1/README.md`](phase1/README.md) | Current runtime setup, tests, image and implementation boundaries |
| [`docs/phase0/README.md`](phase0/README.md) | Current results, blockers, runtime prerequisites, and reproduction commands |
| [`spikes/phase0/api-next/`](../spikes/phase0/api-next/) | Synthetic Next.js/oRPC example and browser/API tests |
| [`spikes/phase0/database/`](../spikes/phase0/database/) | Tenant transaction, PostgreSQL RLS, and database integration experiments |
| [`spikes/phase0/identity/`](../spikes/phase0/identity/) | Identity adapters, assurance checks, and lifecycle race fixtures |
| [`spikes/phase0/authz/`](../spikes/phase0/authz/) | Rejected candidate, fault tests, benchmark, and retained evidence |
| [`scripts/phase0/`](../scripts/phase0/) | Toolchain and compiled API checks |
| [`package.json`](../package.json) | Commands that actually exist today |

The `apps/web`, `apps/worker`, and initial shared `packages/` layout is implemented. Start with the [Phase 1 local setup](phase1/README.md). The architecture document also lists later domain modules that are not implemented yet.

For initial local exploration, the current documented prerequisites are **Node 24.19.0** and **Bun 1.4.2**. From the repository root:

```sh
bun install --frozen-lockfile
bun run phase0:toolchain
bun run phase0:typecheck
bun run phase0:test
```

`phase0:test` skips real-service suites. With Docker Engine and Compose available, the integration path is:

```sh
bun run phase0:services:up
bun run phase0:test:integration
bun run phase0:services:down
```

These commands target disposable fixtures; stopping the Compose services discards their temporary database data. Database/service overrides must point to disposable test environments. Follow the [reproduction guide](phase0/README.md) for build, browser, and API checks. The synthetic Next app is a synthetic fixture only, and its tests do not replace application acceptance.

Useful first contributions include explaining a spike’s behavior, improving reproduction documentation, or adding a focused regression case for a discovered problem. Implement production features in the roadmap’s dependency order once their prerequisites pass.

## 9. What “done” means for a feature

Reviewers should be able to see working behavior, correct tenant/permission enforcement, safe database changes, handled failure states, and relevant test evidence. Vitest covers unit and integration behavior; Playwright covers browser journeys; Storybook demonstrates component states. Type checks, builds, and the CI quality checks support these tests.

Important cases include two different organizations, one user belonging to both, revoked permissions, concurrent changes, and repeated jobs or requests. A happy-path screenshot cannot establish those properties. AI-authored code must meet the same criteria; the planned skills guide implementation and do not replace verification.

For deeper reading, use the [project overview](00-project-overview.md) as the index, then the [data model](03-data-model.md), [billing and operations](04-billing-usage-operations.md), [AI skill plan](05-ai-agent-skills.md), and [Docker image plan](07-ci-and-docker-image.md) for the area you are working on.
