# Customers verification — 2026-09-27

Implemented against template commit `58a5b8cc84d5b728db10bda79b9f0e1920026ee9`.
The initial working tree was clean. One Codex implementation agent used the three
requested repository skills; no delegation. Exact model ID/reasoning metadata was
not exposed, so it is not inferred. This is application verification, not a
`skills:evaluate` live-agent evaluation or a universal skill-reliability claim.

The local source manifest `artifacts/example-customers/source-manifest.json` records
SHA-256 for the 45 changed/new source files and each skill/reference read, with the
complete source patch at `artifacts/example-customers/source.patch`. These ignored
evidence files are available in the original local verification bundle, not a clean
checkout. Source digest:
`c432ce7eaf229c75ca4a7e5b8cca1ba53a106176d2ac1e65ec0f5bc390ae0720`.
The manifest excludes this verification record and ignored artifacts to avoid a
self-referential hash. The [feature brief](example-customers.md) owns decisions;
the [feature README](../../apps/web/src/features/example-customers/README.md) maps code,
request flow, adaptation/removal and fixture setup.

## Executed checks

| Command | Actual result |
| --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | Passed with Bun 1.4.2; no external dependency changes. New workspace dependency connects DB service validation to the shared strict contracts. |
| `bun run check` | Passed; 253 source files, no formatting/lint findings. |
| `bun run typecheck` | Passed for root and web. Node 24.19.0. |
| `bun run knip` | Passed; schema entry is explicit, no new ignore exceptions. |
| `bun run test:unit` | Final run: 18 files, 129 tests passed. See `artifacts/example-customers-unit-with-cursors.log`. |
| `bun run test:integration` | Full run: 142 passed, one old migration-count assertion failed (8 versus new total 9). No service cases silently skipped. See `artifacts/example-customers-integration-full.log`. |
| `bun run test:integration packages/db/src/migrations.integration.test.ts packages/db/src/example-customers packages/api/src/example-customers` | After updating the expected journal length, all 14 affected cases passed. See `artifacts/example-customers-integration-rerun.log`. The other 129 full-run cases were unchanged; the whole suite was not rerun unnecessarily. |
| `bun run test:integration packages/api/src/example-customers` | Two RPC/REST cases passed again after adding valid-shaped bearer+cookie rejection on every endpoint. See `artifacts/example-customers-api-all-principals.log`. |
| `bun run build` | Passed, including final query/cursor recovery code and packaged runtime. See `artifacts/example-customers-build-cursor-recovery.log`. |
| `bun run storybook:build` | Passed; six feature stories (table, Spanish, dark, validation, pending, preserved failure). See `artifacts/example-customers-storybook.log`. |
| `bun run test:e2e tests/e2e/example-customers.spec.ts` | Final run: 3 real-service Chromium journeys passed, including added cursor-error recovery. See `artifacts/example-customers-browser-cursor-recovery.log`. |
| `bun run skills:check --static` | Passed skill references, immutable migration history, executable DTO allowlists and explicit principal declarations. Latest report under `artifacts/phase4/checks/1790472574326-1446a9dc-d08f-4e29-b19e-4f8c6f4cb207/`. |
| `bun run example-customers:fixture` (twice) | Both completed for the same isolated organization and stable fixture keys. 90 varied contacts; no duplicate creation. See `artifacts/example-customers-fixture-first.log` and `artifacts/example-customers-fixture-repeat.log`. |
| `git diff --check` | Passed. No applied SQL/snapshot was rewritten. |

## Behavioral evidence

- Real persisted create/read/update/delete; organization readers denied writes,
  outsiders/wrong organization denied, revoked session/membership denied, current
  MFA policy and independent readiness rechecked even for idempotent replay.
- Concurrent identical creates produce one row/receipt/event pair. Changed-payload
  retries conflict. Updates use expected versions; delete/replay retains a tombstone
  while normal reads/lists exclude it. Contact details never enter audit/outbox.
- Restricted web role: absent/wrong tenant context hides rows; composite receipt FK
  rejects foreign-tenant customers; physical deletion and ownership rewrites fail.
  Both tables force RLS. Worker/identity roles receive no contact access.
- 90 customers traversed without duplicates in all six sort orders with ID ties and
  NULL-company-last semantics. Search covers all three fields, literal wildcards,
  status filters and multiple pages. Page-size choices remain bounded.
- Actor/organization/filter/sort/direction/size cursor mismatch, authenticated token
  tampering, noncanonical encoding, changed secret and 30-minute expiry rejected.
  Sort values are encrypted. Final expiry and connection-loss faults roll back.
- Fresh installations used by all feature tests; a populated 0007 predecessor keeps
  existing organizations, Projects, audit/outbox and closed readiness unchanged.
  Journal replay is idempotent. Existing earlier upgrade/rollback suites also pass.
- Browser: keyboard field validation/focus, native modal Escape/focus return, URL
  refresh/back, server filters/sorts, cursor previous/next, deleted last-page row,
  local drafts after stale edits and failures, and same-key retry after a lost
  response **following a real server commit**. Denied member writes preserve drafts.
  Delayed obsolete query responses do not replace the current view. Cursor failure
  can reset even when query parameters already equal the defaults.
- English/Spanish UI, dark theme, mobile labeled rows, all essential fields/actions,
  and no horizontal document overflow checked in Chromium. Screenshot inspection
  supplements behavioral checks; it does not claim exhaustive accessibility proof.

## Failures retained and fixed

Early local-network attempts were blocked by the sandbox; the authorized disposable
service runs used reviewed escalation. Initial service tests found a PostgreSQL
constant in `ORDER BY`; fixed before the successful four-case service run. The
intentional connection-kill fixture now handles its expected socket-error event.
Those first diagnostics are retained in the session tool transcript.

Unit guard runs rejected unparsed Zod defaults and a registration order that changed
a pre-existing negative-control target. Defaults now use validated `prefault` and
new registrations follow existing ones. Evaluator tests were not weakened. Earlier
unit outputs remain in `artifacts/example-customers-unit.log` and
`artifacts/example-customers-unit-rerun.log`.

Browser attempts found an optional-label selector mismatch, a **real rapid-filter
race**, and an unscoped alert selector that also matched Next's route announcer.
The query controller composes pending updates; assertions now target actual labels
and dialog alerts. Earlier logs remain in `artifacts/example-customers-browser.log`,
`artifacts/example-customers-browser-rerun.log` and
`artifacts/example-customers-browser-query-fix.log`. The successful pre-recovery run
is retained as `artifacts/example-customers-browser-final.log`.

## Screenshots and limits

The ignored local screenshot directory `artifacts/example-customers/screenshots/`
contains `customers-desktop.png`, `customers-spanish-dark.png`,
`customers-mobile.png` and `customers-stale-edit.png` (preserved draft after a
stale edit). These images are not shipped in a clean checkout.

Not run: the full pre-existing browser suite, image build/acceptance, dependency/image
security scans, live-agent evaluation or Phase 3 performance benchmark. No claims
are made for those gates, billing, permanent erasure or the future restore journal.
All feature-specific required services were available. Screenshots/logs/private
fixture environment are ignored local artifacts; source and this record are reviewable
working-tree changes. Nothing was committed, published or deployed.
