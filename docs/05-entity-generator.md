# 5. Entity generator specification

## 5.1 Objective and scope

Implement a TypeScript CLI in `packages/cli` that turns a validated, versioned entity declaration into a complete feature. It must produce code developers can inspect and extend, with the platform's security and operational patterns already wired in.

**All commands and generated paths below are planned interfaces, not working scripts in this planning folder.** The example YAML is a proposed input contract. It is not a claim of compatibility with an existing generator package.

A generated entity includes:

1. PostgreSQL schema, constraints, indexes, migration, and tenant RLS setup.
2. A typed database model plus separate create/update/read DTOs and validation.
3. Tenant-aware repository and domain service, with concurrency and lifecycle rules.
4. ReBAC resource registration, relations, permissions, and policy assertions.
5. REST collection/item routes, public API schema, and server-action adapters.
6. Dashboard list/create/detail/edit screens, forms, table columns, and navigation.
7. Audit events, domain events, optional quota/usage hooks, and outbox wiring.
8. Fixtures, integration/security tests, UI journey coverage, translations, and module documentation.

The generator does not infer domain meaning from a table name. Pricing, approval flows, sensitive fields, parent inheritance, deletion semantics, and usage triggers must be declared or implemented in explicit hooks.

## 5.2 Proposed command surface

```bash
# Create a product from the template; local output only.
pnpm saas init my-product --preset b2b

# Create/validate a declaration, and preview its complete file/schema diff.
pnpm saas entity spec Project --out entities/project.entity.yaml
pnpm saas entity validate entities/project.entity.yaml
pnpm saas entity plan --spec entities/project.entity.yaml

# Produce the feature and migration files without applying database changes.
pnpm saas entity create --spec entities/project.entity.yaml

# Review an existing entity declaration change and generate its evolution.
pnpm saas entity evolve --spec entities/project.entity.yaml --dry-run
pnpm saas entity evolve --spec entities/project.entity.yaml

# Inspect generated/custom file ownership and incomplete integration steps.
pnpm saas entity doctor Project
pnpm saas doctor

# Separate developer/deployment lifecycle commands.
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm authz:validate
pnpm authz:publish
pnpm test:integration
pnpm test:e2e
```

An interactive `entity spec` prompt may help compose a declaration. CI uses the same noninteractive validation contract with explicit inputs. `create` and `evolve` exit nonzero with actionable diagnostics on ambiguity; they never guess a destructive rename/drop or silently apply migrations to a live database. `authz:publish` is a separate environment-specific release step, not part of local code generation.

## 5.3 Declarative contract

The [Project example](../examples/entities/project.entity.yaml) is the canonical sample in this plan. The future CLI publishes a JSON Schema for editor completion and a Zod schema for runtime validation.

Required declaration areas:

| Area | Required information |
| --- | --- |
| Identity | Specification version, singular/plural names, module key, route, SQL table name |
| Scope | `organization` by default; explicit reviewed system scope for platform entities |
| Fields | Type, nullable/required status, length/range, enum values, defaults, validation |
| Exposure | Create/update/read allowlists, sensitive classification, filter/search/export exposure |
| Relationships | Parent type, cardinality, owning side, tenant constraint, delete behavior, inheritance |
| Indexes | Uniqueness, columns, allowed query access patterns, soft-delete behavior |
| Authorization | Known policy template or explicit relation definition, create/read/update/delete/share permissions |
| Lifecycle | Soft/hard delete, restore behavior, concurrency, hooks, audit/event names |
| Commercial hooks | Entitlement key, quota metric/capacity rule, explicit usage event trigger if any |
| UI | Labels, icon from registry, columns, filters, form controls, detail sections, empty state |
| API | Public/private exposure, allowed operations, pagination defaults/limits, idempotent create |
| Verification | Required policy fixtures, security invariants, optional business examples |

Field types initially include string/text, boolean, integer, fixed-precision decimal, date, timestamp, enum, UUID, same-tenant belongs-to relation, and schema-validated JSON. Add money, file references, many-to-many relations, and rich text through well-defined extensions. Default HTML rendering escapes user input; rich text requires a sanitization policy.

Reserved fields (`id`, `organizationId`, audit actors, timestamps, version, deletion state) are server-owned. The CLI rejects client-writable declarations for them. Relation dropdowns use authorized search endpoints, not unrestricted global tables. Decimal DTOs use strings; timestamp DTOs use a documented ISO format.

## 5.4 Generated output for Project

Exact migration metadata filenames follow the pinned Drizzle version. These paths show the intended responsibility split:

```text
entities/project.entity.yaml
.saas/generation/project.json                         # Versions, inputs, outputs, hashes
packages/db/src/schema/projects.ts                    # Table, indexes, constraints
packages/db/migrations/<ordered-project-migration>/   # SQL + Drizzle metadata
packages/modules/projects/
  src/generated/project.model.ts                     # Database-derived types
  src/generated/project.schemas.ts                   # Input and output contracts
  src/generated/project.repository.ts                # Scoped SQL and keyset queries
  src/generated/project.service.ts                   # Standard command/query flow
  src/generated/project.policy.ts                    # Explicit permission mapping
  src/generated/project.events.ts                    # Versioned events and audit fields
  src/generated/project.module.ts                    # Registrations and exports
  src/custom/project.hooks.ts                        # Created once, developer-owned
  src/custom/project.rules.ts                        # Created once, developer-owned
  tests/project.integration.test.ts                   # Meaningful persisted behavior
  tests/project.security.test.ts                      # Isolation/access regression cases
packages/authz/model/generated/project.fga           # Combined into one tested model
packages/authz/tests/project.yaml                     # Allow/deny graph assertions
packages/testing/src/factories/project.ts
packages/api-contracts/src/generated/projects.ts
apps/web/src/app/api/v1/organizations/[organizationId]/projects/route.ts
apps/web/src/app/api/v1/organizations/[organizationId]/projects/[id]/route.ts
apps/web/src/app/(dashboard)/app/[orgSlug]/projects/page.tsx
apps/web/src/app/(dashboard)/app/[orgSlug]/projects/new/page.tsx
apps/web/src/app/(dashboard)/app/[orgSlug]/projects/[id]/page.tsx
apps/web/src/app/(dashboard)/app/[orgSlug]/projects/[id]/edit/page.tsx
apps/web/src/features/projects/generated/
  project-form.tsx
  project-table.tsx
  project-detail.tsx
  project-actions.ts
  project-navigation.ts
  project-messages.en.json
apps/web/src/features/projects/custom/                # Optional UI overrides
apps/web/tests/projects.e2e.ts
docs/modules/projects.md
```

Update database exports, module registry, navigation registry, OpenAPI assembly, translation registry, and authorization model assembly through AST transforms or managed manifests. Do not patch arbitrary TypeScript with fragile regular expressions.

Database model types are not API DTOs. Sensitive/server-owned fields must not leak through an ORM row spread. Generated forms, APIs, audit changes, and exports each use their respective allowlist.

### Generated endpoint behavior

| Endpoint | Behavior |
| --- | --- |
| `GET .../projects` | Authorized fields/resources, validated search/filter/sort, bounded opaque cursor pagination; no unrestricted total |
| `POST .../projects` | Validate, authorize create, check entitlement/capacity, write once per idempotency key, grant initial manager, audit/outbox |
| `GET .../projects/{id}` | Same-tenant lookup, read permission, DTO projection, existence-concealing policy |
| `PATCH .../projects/{id}` | Write-field allowlist, edit permission, expected version/ETag, business validation, audit/outbox |
| `DELETE .../projects/{id}` | Delete permission, declared lifecycle, idempotent state transition, quota/grant cleanup |

Generate restore/share endpoints only when enabled and supported by a tested policy template. Bulk operations and export endpoints are separate declared capabilities with per-item authorization, not automatic copies of unrestricted CRUD.

## 5.5 Generation pipeline

1. **Load and validate:** check specification version, identifiers, paths, fields, supported policy/relationship combinations, and module dependencies. Reject reserved words, path traversal, duplicate route names, duplicate table names, invalid limits, and unknown templates. YAML input is data, not executable code.
2. **Build an intermediate representation:** resolve singular/plural names, SQL/TS/API names, validators, permissions, relations, queries, and UI controls once. Every renderer consumes the same normalized representation.
3. **Check prior state:** find previous generation metadata and repository changes. Acquire a local generation lock; simultaneous generators cannot race on shared schema/migration files.
4. **Stage output:** render in a temporary tree containing the whole current schema, migration history, and relevant manifests. Do not overwrite the working tree while validating.
5. **Generate migration:** run pinned Drizzle Kit against the staged schema and previous snapshots. Extend it with reviewed custom SQL for any RLS, grants, constraints, or indexes not safely represented by that version. Keep the SQL and schema snapshots consistent.
6. **Validate:** format/typecheck staged output, validate the combined OpenFGA model/assertions, validate OpenAPI, detect missing integration registrations, and check generated migration/security conventions.
7. **Produce a reviewable diff:** list files, SQL operations, access model changes, required module/plan keys, manual hooks, and potential data backfills. `--dry-run` stops here with no working-tree writes.
8. **Apply locally:** check files have not changed since staging; write through a manifest-backed operation with recovery if interrupted. Preserve unrelated user changes. Record generator/template/spec versions and original/generated file hashes.
9. **Report next commands:** local migration, model deployment for the selected environment, seed, and appropriate validation. Do not claim the feature is deployed simply because source was created.

Drizzle Kit generates SQL migrations from declared schemas and supports custom SQL migrations. The CLI should reuse that history mechanism rather than invent a competing database diff engine. [Drizzle Kit generation](https://orm.drizzle.team/docs/drizzle-kit-generate)

`pnpm db:generate` must use the same wrapper and security checks as entity generation. It must not offer an alternate route that omits RLS policies. Automated CI fails when a new tenant table lacks its required constraints or policy migration.

## 5.6 Evolution and ownership rules

Three ownership classes:

- **Managed:** deterministic generated files. Regenerate only if their current hash matches the last generated version, or present a merge conflict for review.
- **Developer-owned:** hooks, custom business rules, UI overrides, and hand-written tests. Create once; never replace automatically.
- **Historical:** applied migrations and past authorization model releases. Append new versions; never regenerate history in place.

Running the same declaration with the same generator version twice produces no diff and no second migration. Rendering is deterministic; migration identifiers are allocated once per actual change. All generated references resolve through stable exports so developers can replace a screen without forking the service security flow.

Evolution rules:

| Change | Required treatment |
| --- | --- |
| Add optional field | Generate additive migration, contracts, and UI change |
| Add required field with existing data | Expand nullable or safe default, explicit backfill, then enforce NOT NULL |
| Rename field/entity | Require explicit old-to-new mapping; preserve data and plan API compatibility |
| Change enum/precision/type | Analyze conversion and compatibility; require a reviewed migration/backfill when unsafe |
| Remove field/relation | Deprecation and explicit destructive change intent; no inferred drop |
| Change tenant scope | Refuse automatic migration; require a designed tenant-data migration |
| Change permissions/parent inheritance | Generate new model version, deny/allow assertions, graph backfill/reconciliation plan |
| Enable soft deletion | Update queries, uniqueness, restoration, grants, retention, and quota semantics together |
| Update generator version | Show managed-code diff, use codemods/version compatibility, preserve custom ownership |

Custom hooks can add business validation or transactional work through approved interfaces. They cannot bypass tenant context, override an authorization denial, skip audit, or perform external effects inside the transaction. Side effects subscribe to versioned domain events after commit.

## 5.7 Initial policy templates

- **organization-administered:** organization admins manage resources; explicit readers/editors or declared organization visibility.
- **resource-shared:** creator gets manager relation; members/teams receive explicit viewer/editor/manager grants.
- **parent-inherited:** a child references one validated same-tenant parent and inherits declared permissions; optional explicit child grants.

Generate against these bounded templates first. Arbitrary relationship graph synthesis, nested groups, polymorphic parents, and cross-tenant sharing require a custom module. Unsupported declarations fail with a precise reason rather than silently falling back to permissive access.

## 5.8 Generator acceptance suite

The generator is infrastructure: its defects multiply into every product. Tests should prove externally meaningful behavior, not just compare template text.

1. Generate Project into a clean fixture application, migrate a real database, publish the test authorization model, start the app, and complete create/list/read/edit/delete through the dashboard/API.
2. Generate a child Task with a same-tenant Project reference. Prove inheritance and reject a cross-tenant parent in both service and database layers.
3. Exercise two organizations, overlapping users, a viewer, an editor, an administrator, a revoked member, and a scoped API key. Attempt list, count/search, read, mutation, export, and relation lookup leaks.
4. Remove an individual/team grant, delay or crash graph projection, and prove new operations cannot use stale access. Also test resource parent changes and combined model upgrades.
5. Submit server-owned/hidden fields, unknown filters, malformed cursors, excessive page sizes, duplicate creates, and stale update versions. Confirm safe failures and no secret DTO/audit leakage.
6. Race two creates against the final quota unit; only one succeeds. Retry one idempotency key and verify one record, one quota consumption, and one semantic event.
7. Change a declaration: add field, backfill required field, explicit rename, remove field, and alter permission inheritance. Prove data preservation or a clear refusal with required migration steps.
8. Customize a hook/screen, regenerate, and prove developer edits survive; conflicting edits to a managed file produce a reviewable conflict.
9. Run generation twice and compare the entire tree; the second run creates no changes. Interrupt a write and prove safe recovery without lost unrelated files.
10. Run keyboard/accessibility checks for forms, errors, dialogs, and table controls. Test loading, empty, denied, quota, and conflict states.

First implementation should hand-build the reference Project feature and pass these platform invariants before extracting generator templates. Generating unproven patterns would scale the initial mistakes.
