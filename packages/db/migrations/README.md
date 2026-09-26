# Reviewed Phase 1 migrations

`0000_foundation` creates runtime heartbeat and isolated Better Auth adapter tables.
`0001_durable_probes` adds durable receipts for the synthetic worker smoke test.
Both are additive transactional migrations. The integration suite applies the first
migration as the previous baseline, preserves its heartbeat row, then upgrades and
replays the full journal. There is no released application version before Phase 1.

Drizzle Kit generates the SQL/snapshots. Schema privileges are reviewed custom SQL:
web can only read runtime diagnostics; worker can write heartbeat/probe receipts;
identity uses a separate role; the migrator owns DDL. The worker has DML privileges
in the isolated pg-boss schema; pg-boss installation/upgrades run only in the
migration command. No production tenant tables or RLS acceptance is claimed yet.

Generate from the repository root with
`node node_modules/drizzle-kit/bin.cjs generate --config packages/db/drizzle.config.ts`.
Review grants, lock impact and the generated snapshot before applying. Do not edit
applied migrations. Use the explicit `db:migrate` command and a migration-only URL.
