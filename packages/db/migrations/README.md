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
