# Developing features in the Foundation

Repository skills guide ordinary source edits; they are not a runtime customer-prompt interface or a feature generator. Start with [AGENTS.md](../../AGENTS.md), the current diff and the applicable Markdown brief. Preserve custom code, data and history. A small edit does not require a new brief or fixed questionnaire. Repeating satisfied work should produce no unnecessary artifact; resuming requires inspection of actual source, migration state and prior receipts.

## Current implementation map

| Responsibility | Maintained source |
| --- | --- |
| Tenant schema and lifecycle transactions | [tenancy-schema.ts](../../packages/db/src/tenancy-schema.ts), [tenancy.ts](../../packages/db/src/tenancy.ts) |
| Project schema and domain services | [resource-schema.ts](../../packages/db/src/resource-schema.ts), [resources.ts](../../packages/db/src/resources.ts) |
| Reviewed SQL, snapshots and journal | [migration instructions](../../packages/db/migrations/README.md), [Drizzle config](../../packages/db/drizzle.config.ts) |
| Resource authorization and bounded model compiler | [resources.ts](../../packages/authz/src/resources.ts), [model.ts](../../packages/authz/src/model.ts) |
| Independent readiness and operator controls | [control.ts](../../packages/authz/src/control.ts), [operator.ts](../../packages/authz/src/operator.ts), [Phase 2 protocol](../phase2/authorization.md) |
| Service-account provisioning, current eligibility | [keys.ts](../../packages/authz/src/keys.ts), [resource endpoint boundary](../../packages/api/src/resource-boundary.ts) |
| Strict DTOs and RPC/OpenAPI contracts | [resources.ts](../../packages/api-contracts/src/resources.ts), [router.ts](../../packages/api/src/router.ts), [handlers.ts](../../packages/api/src/handlers.ts) |
| Runtime service composition and client | [runtime.ts](../../packages/api/src/runtime.ts), [client.ts](../../packages/api/src/client.ts) |
| Project UI and navigation | [projects.tsx](../../apps/web/src/components/projects.tsx), [organization.tsx](../../apps/web/src/components/organization.tsx) |
| Product appearance | [developer configuration](../../apps/web/src/product-theme.ts), [shared tokens](../../packages/ui/src/theme.css), [customization guide](theming.md) |
| Shared forms, stories, locale copy | [project-form.tsx](../../packages/ui/src/project-form.tsx), [project-form.stories.tsx](../../packages/ui/src/project-form.stories.tsx), [messages.ts](../../packages/ui/src/messages.ts) |
| Runtime validation and public allowlist | [server.ts](../../packages/config/src/server.ts), [client.ts](../../packages/config/src/client.ts) |
| Real-service fixture and checks | [installation.ts](../../packages/testing/src/installation.ts), [verification](verification.md) |

The route family is `apps/web/src/app/[locale]/organizations/[organizationId]/`; RPC and REST share the same services via `/api/rpc` and `/api/v1`. `/api/openapi` exposes the contract. The illustrative `packages/modules/projects`, JSON locale files and module registry in planning documents do not exist in this implementation; do not create empty architecture merely to match that example. Update actual package exports, runtime composition, router, navigation and locale keys required by the change.

## Design decisions and boundaries

Record the user journey, actors, fields and limits, server-owned state, same-tenant relations, lifecycle, independent input/output/filter/search/export/audit exposure, allowed principal types, entitlements/capacity and acceptance examples when relevant. Infer routine choices from the slice; resolve consequential ambiguity around access, money, deletion and user behavior. A dependency in `package.json` does not prove a module exists: read [module availability](module-availability.md).

Use the canonical [authorization contract](../02-architecture-and-security.md#26-relationship-based-authorization), [lifecycle lock order](../03-data-model.md#canonical-lifecycle-lock-order), [recovery protocol](../04-billing-usage-operations.md#recovery-readiness-protocol), and [implemented resource behavior](../phase3/README.md#resource-and-policy-boundary). These documents own platform protocols; skills link to them instead of creating competing abbreviated procedures. Existing services own identity, authorization, policy, capacity and atomic event writes.

A pure child whose immutable parent governs every operation may authorize the parent through the current boundary. Explicitly map each child operation to parent permission and service-key scope; test revocation and cross-tenant references. A new independent grant/inheritance graph needs reviewed model/compiler/source-loader changes and publication/upgrade compatibility. It cannot be represented by a permissive hook or a renamed Project type. Preserve the final transaction-wide expiry guard across all authorization batches and the same lock-bearing database connection.

DTOs are explicit contracts, never database row types. Server-owned IDs, tenants, actors, timestamps, versions and deletion fields are not client inputs. Keep decimal serialization as strings and timestamps documented ISO values. Mutations own current permission, versions, domain validation, local policy, scoped idempotency and audit/outbox in one transaction. External work occurs after commit. A prior allowed result or hidden UI control is not current authorization.

## SQL and evolution

Use the pinned command in the [migration guide](../../packages/db/migrations/README.md): `node node_modules/drizzle-kit/bin.cjs generate --config packages/db/drizzle.config.ts`. Review SQL, constraints, RLS/grants, lock impact, journal and snapshots together. There is no root `db:generate` script. Apply reviewed SQL only to the task's authorized local/test installation with `bun run db:migrate`; test restricted runtime roles and preceding-schema upgrades. Applied SQL and published models remain historical artifacts.

Required-field changes on existing data need expand/backfill/enforce behavior; rename/drop/type/tenant changes need explicit compatibility decisions. Backfills require bounded restartable semantics and evidence preserving old rows. Use current customized source as the input. Do not add generation manifests, copied policy engines or automatic rewrite behavior when a skill version changes. Follow [verification](verification.md) and report the reviewable source/SQL/access diff plus actual evidence and limitations.
