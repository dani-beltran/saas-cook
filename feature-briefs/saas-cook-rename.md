# SaaS Cook project rename

The product name is **SaaS Cook**, the root package and image name are `saas-cook`, and active workspace packages use `@saas-cook`. Apply the name to runtime branding, authentication display names, page/API metadata, examples, tooling and maintained documentation. The checkout directory and Git remote are outside this source rename.

English remains the default locale, with English and Spanish supported. Existing Foundation identity, organizations/teams, direct-Organization Projects, example customers, local capacity, API/service accounts, transactional identity email and personal settings remain available. Billing, analytics, Commercial, Enterprise and Backoffice capabilities retain their existing planned/unavailable status. Existing fixtures continue to use synthetic `example.test` identities; this rename creates no accounts or installation data.

## Compatibility

- PostgreSQL databases and roles use `saas_cook`; the explicit fresh reset below supersedes the original decision to retain legacy database identifiers.
- The Compose project is `saas-cook-phase1`, with the matching `saas-cook-phase1_default` image-test network.
- Keep signed ingress headers `x-common-saas-source*` and the `common-saas-ingress:v1` signing domain, including their tests and proxy documentation, compatible with configured ingress. These are protocol identifiers, not display names.
- Keep the retired `common-saas-appearance` key in the test/documentation proving that old browser preferences are ignored.
- Preserve Phase 0 source, scripts, evidence and `@common-sass/phase0-*` package names, plus recorded acceptance/evidence and historical verification commands.
- Use the new name for newly created OpenFGA store labels; existing store IDs, labels and initialization receipts are not rewritten.
- Preserve local `.env` credentials and installation configuration while updating database targets and role names to the new prefix.

## Database reset

On 2026-09-27 the user explicitly requested replacing `common_saas` with
`saas_cook`, including database connections, database/role names and migrations,
and resetting the local database from the beginning. This authorizes a one-time
rewrite of the role identifiers in migration SQL and cumulative snapshots rather
than an additional compatibility migration. Existing local accounts and tenant
data are discarded. This does not provide an upgrade path for populated legacy
installations.

The disposable application, control and OpenFGA databases become `saas_cook`,
`saas_cook_control` and `saas_cook_fga`. Web, worker, identity, migrator, control
reader and control administrator retain separate restricted roles with the new
prefix. Active source/schema declarations, test fixtures, CI, operator commands,
image acceptance, setup documentation and `.env` use those names. The full journal
and snapshot ancestry remain in order; only role identifiers change in SQL/JSON.
The migration guard records exact SHA-256 pairs in
`scripts/phase4/saas-cook-history-reset.json`; it accepts only this specific
transition and rejects other history changes. Historical acceptance evidence and
held-out evaluator baseline hashes remain unchanged; a future live evaluation
needs a new evaluator-owned baseline for this reset source.

Stop the old local development processes and the old Compose project, start the
renamed disposable services, apply `db:migrate`, then run `bootstrap` and
`authz:publish`. The existing synthetic installation ID may be reused only because
both the application and independent control stores are freshly recreated; fresh
binding, epoch and model receipts are established together. Restart development
with the updated `.env` afterward.

### Reset verification

Completed on 2026-09-27 with Bun 1.4.2 and Node.js 24.19.0:

- Removed the old disposable Compose stack and started `saas-cook-phase1`.
  `services:up`, `db:migrate`, `bootstrap` and `authz:publish` all passed.
- Queried both PostgreSQL instances: only the three new database names and six
  restricted role names remain for this product. All ten recorded migration
  hashes match the renamed SQL. The reset application has zero users and
  organizations; its binding/epoch match the ready independent control store.
- Passed source formatting, strict types, Knip, static skill contracts and the
  exact migration-history transition guard. The initial source check found one
  formatting change caused by the shorter role name; fixed it and reran.
- Passed all 146 unit tests and all 150 real-service integration tests. Coverage
  includes fresh/preceding-schema migrations, replay, role separation, identity,
  authorization, tenant isolation, resources and worker startup/recovery.
- Passed the production build and four browser tests covering localized/mobile
  pages, OpenAPI, synthetic registration, email confirmation, memberships and
  organization isolation. Browser fixtures used a separate disposable installation.
- Restarted local development using the updated `.env`; web health and a fresh
  worker database heartbeat were verified.

Evidence is under `artifacts/saas-cook-database-rename/`; browser reports are under
`artifacts/playwright/saas-cook-database-rename/`. Ad-hoc audit queries initially
used two incorrect column names; corrected them against the schema and completed
both read-only audits. The full browser matrix, Storybook, Docker image acceptance,
security scans and live-agent evaluations were not rerun for this reset.

## Original branding verification

Verified on 2026-09-27 with Bun 1.4.2 and Node.js 24.19.0:

- Refreshed `bun.lock` with pinned Bun and passed `bun install --frozen-lockfile`. Compared parsed lockfiles to confirm only intended project/package names changed, with all dependency resolutions preserved. Bun's temporary/cache writes required sandbox escalation.
- Passed `bun run check`, `bun run typecheck`, `bun run knip`, `bun run skills:check --static` and `git diff --check`. The initial source check identified 15 import-order/formatting changes caused by the rename; applied Biome fixes and reran successfully.
- Passed `bun run test:unit`: 145 tests across 20 files.
- Passed `bun run build`: the renamed web workspace and bundled worker/command/supervisor build successfully.
- Passed `bun run test:integration apps/worker packages/email`: the matching worker suite contains two tests, covering readiness diagnostics, durable job recovery, trace correlation and shutdown. There is no separate email integration suite under that path.
- Passed `bun run test:e2e tests/e2e/foundation.spec.ts tests/e2e/identity.spec.ts --grep 'localized validation|mobile shell|public diagnostic|real registration, scanner confirmation'`: four browser tests covering localized/mobile pages, OpenAPI and real registration, email confirmation, two memberships and organization isolation. Used an isolated synthetic installation on the existing disposable services.
- Confirmed English/Spanish public defaults, `.env.example` and local `.env` resolve to **SaaS Cook**. Historical sources/evidence, applied migrations and model history have no diff.

Logs are retained under `artifacts/saas-cook-rename/`, with browser reports under `artifacts/playwright/` and `artifacts/playwright-results/`. The full integration/browser suites, Storybook, Docker image acceptance, security scans and live-agent evaluations were not rerun. No existing installation was migrated/reinitialized, and no deployment or live email was performed.
