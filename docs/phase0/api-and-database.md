# API, workspace and tenant-isolation validation

Date: 2026-09-22. Decision: retain the required oRPC/Zod/Next.js and Drizzle/node-postgres adapters. These are disposable synthetic experiments, not production authentication, tenancy or a Project feature.

## API and package boundary

`spikes/phase0/contracts` is a Bun workspace exporting explicit Zod input/output contracts; `api-next` consumes it using `workspace:*`. Turborepo invokes a production Next.js build on Node. One procedure implementation calls one fixture service through both `/api/rpc` and `/api/v1`; the same contract generates `/api/openapi`. The committed lockfile captures the resolution.

The executable tests prove inferred typed-client inputs/outputs, runtime invalid/unknown-field rejection, tenant and role denial, minimal output DTOs, version conflict, idempotent replay/hash conflict, and authorization before returning a receipt. HTTP smoke checks hit the compiled Next Route Handlers, rather than only calling the service. oRPC 1.15.3 uses `.route(...)` metadata; use the installed version's API rather than copying newer unversioned examples. Its default input error is mapped deliberately to HTTP 422 on both transports, with a request ID and safe field issues. All expected error statuses are declared in OpenAPI. Compiled cross-transport retries share one process-local fixture store; production must provide the durable transactional store.

Fixtures require `PHASE0_API_FIXTURES=1` and fixed synthetic bearer tokens. The spike server binds to loopback. This is an adapter experiment with in-memory data and policy; **it is not Better Auth session integration, transactional production idempotency, CSRF protection or real ReBAC**. Those remain Phase 2/3 acceptance. Keep this app as a test fixture; do not copy its context into runtime authentication.

Stack probes render React 19 with next-intl, React Hook Form/Zod and React Email; reject invalid T3 Env configuration; build Tailwind CSS and a Storybook form; and exercise form validation/hydration in the pinned Playwright Chromium. shadcn's pinned CLI/source compatibility is documented in the matrix; importing the product's reviewed component source belongs to Phase 1. Tool installation or one form story is not evidence that the future design system is complete.

## Database boundary

`database/schema.sql` creates a dedicated synthetic schema and restricted login. Tests connect directly as `phase0_runtime`, which does not own tables and cannot bypass RLS, create roles/databases, change table policies, truncate data or assume the migration role. Tenant tables enable **and force** RLS with both `USING` and `WITH CHECK`. Organization keys participate in parent/owner foreign keys.

`tenantTransaction` obtains one pooled client, begins a transaction, sets a parameterized transaction-local organization value, invokes the repository callback, commits or rolls back and returns the client. A pool of size one forces reuse in the tests. Missing context, commit, rollback, terminated connections, alternating/concurrent borrowers, forged inserts/updates, cross-tenant parents and deletes are exercised. Broken clients are discarded rather than returned for reuse. The Drizzle spike separately proves its transaction uses that same connection-local setting and clears it after commit.

The two membership indexes match the canonical data model: unique `(organization_id, user_id)` and **non-unique** `(user_id, status)`. Fixtures include one user active in two organizations; same-tenant duplicates are rejected. Restricted-role query plans exercise both indexes. The organization switcher itself remains a separately authorized identity/control-plane service; the tenant runtime is not granted an all-tenant directory.

The SQL file is a repeatable spike setup, not an application migration history. Fixed passwords and permissive migration credentials are confined to disposable localhost services. RLS does not protect against arbitrary SQL execution by a compromised application that can set its own tenant context; actor eligibility and ReBAC remain mandatory service checks. The exact SQL privilege and row-policy behavior follows the [PostgreSQL row-security contract](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).

## Reproduction

From the repository root with Node 24.19.0 and Bun 1.4.2:

```sh
bun install --frozen-lockfile
bun run phase0:services:up
bun run phase0:typecheck
bun run phase0:test:integration
bun run phase0:build
bun run phase0:storybook
bunx --no-install playwright install chromium
bun run phase0:browser
```

The integration command must report passing real-service tests, not skipped tests. The browser runner starts/stops its own compiled Next server. For the separate live API smoke, start `PHASE0_API_FIXTURES=1 bun run --cwd spikes/phase0/api-next start`, then `bun run phase0:api:smoke`, and stop the server afterward. All credentials/datasets are synthetic. See the evidence register for actual results and the authorization report for the independent load decision.
