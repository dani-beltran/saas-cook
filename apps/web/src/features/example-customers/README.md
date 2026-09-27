# Customers: an example business feature

A working organization contact directory, separate from application identities and
billing customers. Owners/admins can mutate through the existing organization
`manage` permission; current members can read through `read`. All decisions still
use the pinned contextual OpenFGA model, current verified session and tenant
security policy. No new assurance bypass, sharing graph, Project dependency or
billing/seat/customer quota is introduced. Bearer principals are unsupported on
every endpoint, including when a cookie is also present.

## Business code and foundation connections

| Responsibility | Business-owned files |
| --- | --- |
| Frontend | This folder: `customers.tsx`, `use-customers.ts`, `query.ts`, `customer-form.tsx`, `customer-table.tsx`, `customers.css`, `messages.ts`, `customers.stories.tsx` |
| Contracts | [`packages/api-contracts/src/example-customers`](../../../../../packages/api-contracts/src/example-customers) |
| Handlers | [`packages/api/src/example-customers`](../../../../../packages/api/src/example-customers) |
| Schema/service/cursors/tests | [`packages/db/src/example-customers`](../../../../../packages/db/src/example-customers) |
| Synthetic data/session fixtures | [`packages/testing/src/example-customers`](../../../../../packages/testing/src/example-customers) |
| Explicit fixture command | [`scripts/example-customers/fixture.ts`](../../../../../scripts/example-customers/fixture.ts) |
| Browser journeys | [`tests/e2e/example-customers.spec.ts`](../../../../../tests/e2e/example-customers.spec.ts) |
| Reviewed migration | [`0008_example_customers.sql`](../../../../../packages/db/migrations/0008_example_customers.sql), matching `0008_snapshot.json` and journal entry |

Foundation integration is limited to package exports/internal contracts dependency,
Drizzle/Knip schema discovery, runtime service composition, contract/router
registrations, the thin `/[locale]/organizations/[organizationId]/customers` route,
dashboard navigation/localized label, Storybook discovery and the root fixture
command. Feature copy stays here; no customer messages or rules enter generic UI.
The existing tenant audit writer and final authorization-expiry guard are exported
for reuse. The resource endpoint boundary now rejects even an empty Authorization
header for human-only endpoints. No authorization model or published history changes.

## Follow one request

1. `CustomerForm` uses React Hook Form/Zod and shared `Input`/`Button`. The controller
   retains a submission key across identical retries and sends only business fields.
2. `createApiClient().exampleCustomers.create` uses the strict oRPC contract. RPC
   and REST share the same handler (`/api/v1/organizations/{organizationId}/example-customers`).
3. Root registration enters `resourceOperation` with explicit human-only capability.
   It checks request origin/readiness and derives the actor from Better Auth.
4. The feature handler calls the feature service. `withTenantTransaction` holds
   the user then organization fences; the injected foundation authorizer checks
   current session, membership, policy, independent publication and organization
   `manage` on that exact connection, including before receipt lookup.
5. The service locks the scoped operation, validates its digest, writes the customer,
   command receipt and allowlisted audit/outbox event atomically. RLS and a composite
   receipt/customer foreign key enforce organization isolation. Only web receives
   the needed table/column privileges; identity/worker cannot read contact data.
6. The shared final expiry guard runs after all work; the transaction commits and
   an explicit DTO is returned. A response from an obsolete component/query is ignored.

`update`/`delete` also require the expected version. Replays return the **current**
record, potentially a deleted tombstone; they never append another event. A changed
payload with the same key conflicts. Contact details and search text never enter
audit/outbox or application logs. Events contain only action, target ID and version.

Deletion is a versioned soft delete: the row remains stored but normal list/detail
endpoints exclude it. There is no restore or permanent-erasure command. This does
not implement the later full deletion/restore-journal protocol.

## Lists and interface

Search is literal, case-insensitive substring matching on name, email and company.
All filters/sorts execute in SQL; no unrestricted count or complete dataset reaches
the browser. Pages contain 10, 25 (default) or 50 contacts. Name/company sort uses
lowercase PostgreSQL `C` collation; creation sort uses millisecond UTC timestamps.
ID follows the selected direction to break ties. Empty company values become NULL
and always sort last. The default is newest first.

AES-GCM cursors expire after 30 minutes and bind actor, tenant, normalized search,
status, sort, direction and size. A page fetch reauthorizes the whole directory.
Because every customer has the same organization permission, no per-row FGA scan
is needed. Pagination is live keyset traversal, not a snapshot; editing sort fields
can move rows. Search/filter/sort/size live in the URL. Any query or organization
change remounts the directory and clears cursor history. Refresh and browser history
restart that query at its first page. Previous uses in-memory cursor history.
Empty pages after deletion step back until a nonempty page or the beginning.

Dialogs use native modal focus trapping and Escape, with explicit cancellation,
localized announcements and focus return. Recoverable failures retain drafts;
conflicts require an explicit latest-record reload that discards the draft. All
columns/actions remain visible as labeled rows on mobile. Reauthentication links
open account security in another tab so the draft stays in place.

## Run and seed a disposable example

Use the repository’s Bun 1.4.2 / Node 24.19.0 toolchain and local services:

```sh
bun install --frozen-lockfile
bun run services:up
bun run example-customers:fixture
node --env-file=artifacts/example-customers/development.env node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3103
```

The explicit command creates its **own isolated application/control databases and
FGA installation**, applies reviewed migrations, establishes a verified synthetic
owner, and creates 90 varied contacts through the real service. It never accepts an
organization ID and never seeds on startup. Its private receipt and environment are
under ignored `artifacts/example-customers/` (mode 0600). Keep the receipt to resume
or rerun; stable operation keys preserve edited/deleted records without duplication.
It deliberately fails if its recorded installation is no longer available.

Open the organization URL printed by the command. At `/en/account`, sign in as
`customers-developer@example.test` with the synthetic development-only password
`Synthetic Customers password 2026!`. The same directory is available under `/es`.
The generated environment applies only to this disposable instance on port 3103;
ordinary `.env` and existing organizations are untouched. Stop the dev process when
done. These test databases can be discarded with the local service data during an
intentional disposable-environment reset; remove the receipt only when you intend
to create a new isolated example installation.

For an existing authorized local application installation, apply the reviewed
schema normally with `bun run db:migrate`; Customers then works without fixtures.

## Adapt or remove

Start from the brief and the business modules above. Rename the namespace, write
separate input/output/query/event allowlists, define the governing permission and
principal support, add a reviewed schema migration, and adapt the form/table/tests.
Keep the foundation imports and injected authorizer; do not copy its policy,
authentication, lifecycle locks or logging into the entity. Independent sharing or
new graphs need a real reviewed authorization extension; do not alias a new entity
to Project. Add quotas only when the new business requirement calls for them.

To remove the surface, remove its dashboard link and route, contract/router entries,
runtime composition, package export/discovery entries, stories and fixture command.
Remove feature source only after those imports are gone. **Applied migrations,
snapshots and journal entries remain immutable.** A later table removal needs a new
reviewed migration with data-retention/upgrade decisions; never delete or rewrite
`0008` from an installed application's history.

See the [brief](../../../../../feature-briefs/example-customers.md) and
[verification record](../../../../../feature-briefs/example-customers-verification.md)
for actual executed checks and their limits.
