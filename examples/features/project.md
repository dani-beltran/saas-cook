# Project feature brief

**Status:** illustrative developer task for the planned `saas-add-feature` skill. The platform and skill are not implemented in this repository. This Markdown brief replaces the entity-generator YAML contract.

## Task and scope

Add an organization-scoped Projects feature to the Foundation preset. Reuse the implemented tenant, authorization, local entitlement/capacity, audit/outbox, and API-key services. Build ordinary editable source and complete dashboard/API behavior. Use no billing or analytics provider credentials. Follow the [skill workflow and acceptance requirements](../../docs/05-ai-agent-skills.md).

Module/table/route names are `projects`; singular domain name is Project. A project belongs to one organization and an owner membership in that organization. IDs, organization context, timestamps, audit actors, optimistic version and soft-deletion state are server-owned.

## Data and exposure

| Field | Rules | Exposure |
| --- | --- | --- |
| Name | Trimmed string, required, 1–160 characters | Create/update/read, search, audit changes; export only if the export module is explicitly enabled |
| Slug | Required, 1–100 characters, lowercase alphanumeric segments separated by hyphens | Create/read, immutable after creation, audit changes; export only when enabled |
| Description | Nullable text, at most 10,000 characters | Create/update/read; excluded from audit changes and exports |
| Status | `draft`, `active`, `archived`; default `draft` | Create/update/read/filter, audit changes; export only when enabled |

Require unique `(organization_id, slug)` across live and soft-deleted rows so restoration cannot collide. Index organization/created-time/ID and organization/status/created-time/ID. Add a composite same-tenant foreign key for owner membership. Use current platform migration and RLS conventions.

## Access, lifecycle, and capacity

- Use resource-shared access: creator receives manager; active same-organization memberships and teams can receive viewer/editor/manager grants. Organization administrators manage all projects in this example. Cross-organization sharing is forbidden.
- Require `organization.project_create` and `organization.project_list` for the collection operations. Map read/update/delete/restore/share through the current platform policy catalogue. No authorization is granted solely by showing a navigation item.
- This brief enables human/team subjects only. Reject service-account operations for this feature; a separate evaluation variant explicitly enables scoped service identities and tests allowed access.
- Resolve `projects.enabled` and `projects.max_active` through real local policy/capacity services. Count every non-deleted row, including archived status. Reserve capacity on create/restore, release once on soft delete, and never release a second time on purge.
- Use idempotent create and expected version/ETag on updates. Soft delete, restore, sharing and initial grants update the shared authorization revision/readiness state. A committed write awaiting projection displays pending readiness and retries a read without duplicate creation.
- Global account freeze and organization lifecycle policies apply to all operations. Preserve tenant content if its creator deletes their account; ownership responsibility must be reassigned through the account-lifecycle workflow when that module is enabled.

## API and dashboard

Expose REST v1 organization-scoped list/create/read/update/delete/restore/share behavior using existing transport adapters. Public DTOs use explicit allowlists. List through permission-aware cursor scanning, default page size 25 and maximum 100, status filter, created-time/name sorts, and created-time descending default. Relation dropdowns must not reveal inaccessible users/resources. Do not add import/export or file endpoints in Foundation.

Provide list/create/detail/edit pages, Projects navigation with the existing `FolderKanban` icon, name/status/created-date columns, a status filter, and appropriate text/slug/textarea/select controls. Empty state: “No projects yet”, with a “Create project” action. Include English translation keys, keyboard access, and loading/empty/denied/quota/conflict/pending/error states.

## Events and verification

Audit create/update/soft-delete/restore/share using name/slug/status change allowlists. Emit versioned `project.created`, `project.updated`, `project.deleted`, `project.restored`, and `project.shared` events through the transactional outbox with ID/organization/version payloads. Product analytics is added only through its implemented Commercial adapter and explicit event catalogue; a domain event is not automatically a billable or analytics event.

Demonstrate tenant isolation, relation permissions, delayed revocation and late-projector isolation, undeclared/scoped key behavior, field allowlists, duplicate creates, final-capacity races, operation with billing disabled, optimistic concurrency, soft-delete/restore, atomic audit/outbox, and dashboard journeys including pending authorization readiness. Reuse the shared fault harness rather than reimplementing the authorization protocol.

Deliver the source and SQL diff, any policy/configuration decisions, test evidence and remaining work. Preserve existing customizations and applied migration history. If a prerequisite is unavailable, report it explicitly rather than claiming a complete feature.
