# Project and child Task evaluation brief

This is a disposable Foundation evaluation task for `saas-add-feature`, not a generator schema or a request to install Tasks into the reference product. Evaluate an ordinary source diff with real PostgreSQL/OpenFGA, synthetic identity and no commercial credentials. Record `R-SKILLS`, `R-TENANCY`, `R-AUTHZ`, `R-LIFECYCLE`, `R-KEYS`, `R-POLICY`, `R-WORKSPACES` and relevant identity regressions. See [verification](../docs/development/verification.md).

## Project baseline

In a renamed product fixture, inspect and complete the existing Project slice rather than duplicating it. A member can create and immediately read their private Project, edit at an expected version, share with same-tenant members/teams, soft-delete and restore subject to capacity. Owners/admins retain content administration. A viewer cannot edit; a revoked/expired/denied principal cannot retain access. Exercise both RPC and REST and the localized dashboard. Optional workspaces retain the documented archive/disabled behavior. Validate bounded sparse lists without unrestricted totals and one resource/capacity effect/semantic event on a replay. Existing Project source is the example, not frozen generated output.

## Child Task outcome and data

Add a task list within an authorized Project. A Task has `title` (trimmed, 1–160 characters), `completed` (boolean, initially false), immutable same-tenant `projectId`, server-owned ID/version/timestamps and soft-delete state. No independent Task sharing, parent moves, owner field, rich text or billable usage. Every Task access is exactly the current parent Project's permission: `read` for get/list and `update` for create/update/delete/restore. Deleted parents deny child operations. Disabled Projects allow child reads/deletion cleanup but reject create/update/restore. Tasks have no separate capacity bucket; creation cannot bypass the parent's enabled policy.

The fixture uses `tenancy.tasks(id, organization_id, project_id, title, completed, version, created_at, updated_at, deleted_at)`, forced tenant RLS, runtime grants and a tenant-composite FK to Projects. It stores a hidden `internal_note` only if an evaluator needs a sensitive-field sentinel; it never exposes that field in input, DTO, search, audit or logs. Creation, update, soft deletion and restoration commit versioned audit/outbox metadata atomically, without title/content payloads. Current authorization also runs before replay returns a DTO.

## Interoperability seam for held-out tests

For this evaluation only, expose `createTaskService(pool, hooks: ResourceHooks)` from `packages/db/src/tasks.ts`. It returns:

| Method | Input after `(actor, organizationId, ...)` |
| --- | --- |
| `create` | `{ projectId, title, operationKey }` |
| `get` | `{ id }` |
| `list` | `{ projectId, limit?, cursor? }` |
| `update` | `{ id, version, title?, completed? }` |
| `delete`, `restore` | `{ id, version, operationKey }` |

Use camelCase DTOs containing only `id`, `organizationId`, `projectId`, `title`, `completed`, `version`, `createdAt`, `updatedAt`, `deletedAt`; timestamps are ISO strings and deletion is nullable. Lists return `{ items, nextCursor }`, use a bounded stable ordering and authenticated actor/tenant/parent/query-bound cursors. Create/delete/restore idempotency is actor/tenant/operation scoped with request-hash mismatch rejection; stale versions conflict. A repeated request must not add duplicate tasks, events or migrations. Method names/table shape are an evaluation integration seam, not a skill-wide DSL.

Implement a localized Task view and strict oRPC contracts/handlers for the requested CRUD journey. Expose RPC procedures `tasks.create`, `tasks.get`, `tasks.list`, `tasks.update`, `tasks.delete` and `tasks.restore`. REST uses `/organizations/{organizationId}/tasks` (POST create, GET list), `/organizations/{organizationId}/tasks/{id}` (GET, PATCH, DELETE), and `/organizations/{organizationId}/tasks/{id}/restore` (POST), under the existing `/api/v1` handler. The parent relation is supplied on create and list, never changed by update. Read only documented fields; reject client-writable tenant, actor, version-on-create, deletion or internal state. Query parameters/parent pickers cannot bypass permission checks.

## Service-account variant

Support bearer principals only on the Task endpoints explicitly declared in this brief. Because access is pure Project inheritance, use existing `project:read` for get/list and `project:update` for create/update/delete/restore, together with current account/key eligibility and the Project resource grant. A retry returning a current Task DTO also requires current parent read permission. Do not grant organization-administrator inheritance to a service account. Human/team sharing and identity endpoints remain unsupported for bearer credentials.

Test revoked, expired, wrong-tenant and rotated keys, missing scopes, missing Project grant, inactive accounts and an undeclared endpoint. A valid cookie cannot rescue a disallowed bearer header. SQL and services both reject a Project from another tenant. No new Task graph is needed for this exact inheritance contract; a different feature with independent grants must design an explicit graph extension.

## Acceptance examples

- Two organizations have an overlapping user and disjoint Projects/Tasks. RLS without tenant context returns no rows; a tenant cannot insert a foreign parent or discover its children.
- An editor creates a Task, replays it once, edits with the returned version, and sees one semantic event per mutation. A viewer reads but all mutation methods deny. Parent revocation denies the next access.
- Forged/cross-actor/cross-parent/expired cursors and unknown input fields fail safely. DTOs/events never reveal a sensitive sentinel.
- Parent deletion, disabled policy, membership/key expiry, connection loss, late FGA responses, model/epoch changes and endpoint failure obey the production failure boundary, including the final transaction expiry guard.
- Dashboard/API paths agree on authorization and version conflicts; keyboard navigation and English/Spanish loading/empty/denied/pending/conflict/error states work.

Preserve prior custom code and all migration/model history. Run the declared independent repeats and retain failures. The missing Phase 3 performance benchmark is excluded from this Phase 4 execution and remains unpassed.
