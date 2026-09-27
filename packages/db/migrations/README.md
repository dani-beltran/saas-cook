# Reviewed application migrations

`0000_foundation` creates runtime heartbeat and isolated Better Auth adapter tables.
`0001_durable_probes` adds durable receipts for the synthetic worker smoke test.
Both are additive transactional migrations. The integration suite applies the first
migration as the previous baseline, preserves its heartbeat row, then upgrades and
replays the full journal. There is no released application version before Phase 1.

`0002_tenancy` adds forced tenant RLS, organizations, membership/seat transitions,
invitation and ownership lifecycles, teams, and atomic audit/outbox records.
`0003_authorization` adds the local installation binding and contextual source
revisions. `0004_identity` adds passwordless/MFA assurance, credential lifecycle,
restricted identity lookup, and encrypted delivery records.
`0005_tenant_event_integrity` adds the outbox-to-audit composite tenant foreign key
and optional request/trace correlation without rewriting the earlier migration.
New service events always capture a trusted request ID; historical rows remain NULL. Initialization uses
a separately provisioned control database; migrating does not establish readiness.

`0006_resources` adds the Project/workspace registry, tenant-constrained grants,
service accounts and hashed API-key records, scoped command receipts, and generic
capacity buckets/reservations. It is additive: no prior data is rewritten. The
Phase 2 upgrade fixture preserves memberships and audit history before applying
it; a fresh installation applies the full journal. Every new tenant table enables
and forces RLS and has an explicit migrator policy. Web/worker can mutate domain
rows but only grants can be physically deleted; Project deletion is a versioned
soft-delete command. Team removal cascades only its grants. Slugs remain reserved
after Project soft deletion, so restoring a Project cannot collide with slug reuse.
API-key plaintext never enters the database. Capacity defaults are materialized
on the first authorized create or explicit policy command, independently of billing
provider availability.

`0007_organization_projects` retires that optional Workspace domain. The active
hierarchy is Organization → Projects. Its generated cumulative snapshot removes
the Workspace table, Project parent column, registry parent relationship and their
constraints/indexes; reviewed SQL orders these changes explicitly without
`CASCADE`. Migrations `0000`–`0006` and their snapshots remain immutable historical
schema evidence.

The approved access policy retires all inherited Workspace access, including
Workspace positive and denied grants. It creates no replacement grants. Every
Project ID, organization, owner membership, business field, version, timestamp and
soft-delete state survives unchanged, including Projects in archived Workspaces
and Projects without a Workspace. Direct Project grants (including team, service
account, expiry and denied relations) survive unchanged. Organization content
administration remains available; members and service accounts that depended only
on inherited access require explicit Project sharing afterward. See the
[retirement decision](../../../feature-briefs/remove-workspaces.md).

Only retired `workspace:*` and `project:move` capabilities/key scopes are removed;
other Project scopes remain in their original order. An obsolete-only scope list
becomes empty and authorizes no endpoint. Workspace capacity buckets in the
`workspace`/`workspaces` feature namespace and their reservations are removed;
Project and unrelated generic capacity are preserved. Retired Workspace commands,
grant receipts targeting its deleted grants, and move receipts are removed.
Project create/delete/restore and surviving direct-grant receipts remain intact.
In particular, every old Project create input hash included `workspaceId` (even
`null` for unassigned Projects): all pre-migration create retries using the new
contract fail with a conflict rather than duplicating a Project or
pretending the changed request is identical. Clients should refetch the existing
Project and use new operation keys only for new commands.

Historical audit and outbox records, including obsolete fields/action names in
their payloads, remain byte-for-byte JSON-equivalent history; they must not be
replayed as current commands. A new `migration.workspace_retired` audit/outbox event
records per-organization counts of detached Projects, retired grants, commands and
capacity, and changed service accounts/keys. Both source revisions advance in the
same transaction without changing their difference, pinned model, readiness or
recovery epoch. This migration cannot clear recovery state or establish readiness.

Deploy under maintenance: drain/stop old web and worker processes, take the normal
backup, apply the complete journal with the migrator role, run the explicit
supported `authz:upgrade` using the new release, validate the model, then start the
new processes and perform the documented Project access checks. Old/new binaries
cannot overlap this contract migration. DDL and cleanup are one Drizzle
transaction: a failure rolls back data changes and the journal entry, and a
completed journal replay performs no duplicate cleanup or audit append. Unexpected
custom dependencies fail rather than being cascade-dropped. The real PostgreSQL
suite verifies a populated `0006` upgrade, archived/unassigned/deleted Projects,
scopes/capacity/receipts/history preservation, fresh installation and journal replay.

Drizzle declarations and cumulative snapshots mirror the reviewed SQL. Runtime
privileges, `FORCE ROW LEVEL SECURITY`, immutable membership identity and identity
adapter triggers/functions are explicit SQL contracts, and must be preserved by
future migrations. The installed Drizzle introspector does not faithfully preserve
composite-column ordering and policy expressions on the selected PostgreSQL
version; do not blindly replace the declarations or snapshots with `pull` output.
Application web/worker roles are restricted non-owners; identity uses its separate
role; the migrator owns DDL. Queue installation/upgrades remain migration-only.

Generate from the repository root with
`node node_modules/drizzle-kit/bin.cjs generate --config packages/db/drizzle.config.ts`.
Review grants, lock impact and the generated snapshot before applying. Do not edit
applied migrations. Use the explicit `db:migrate` command and a migration-only URL.
