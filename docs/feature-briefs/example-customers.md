# Example Customers

Business contacts, not identity users, memberships or billing-provider customers.
Namespace: `example-customers`; UI route: organization `/customers`.

- Verified human sessions only. Existing organization `read` governs list/detail;
  organization `manage` governs all writes. The existing contextual authorization
  boundary revalidates session, membership, tenant policy/assurance, lifecycle,
  independent readiness and expiry. No new role checks, sharing or model changes.
  Bearer headers (including malformed/empty ones) never fall back to cookies.
- Input: trimmed name (1–120), validated email (max 254), optional trimmed company
  (0–120, empty stored as NULL), status lead/active/inactive (default lead).
  Duplicate names/emails are permitted: contacts are not identities.
- Server owns UUID, immutable tenant, positive version, UTC timestamps and deletion.
  Output exposes these plus business fields; search covers name/email/company only.
  No quota, billing, email delivery, enrichment, import/export or Project relation.
- Versioned soft deletion removes contacts from normal list/detail. Data and command
  receipts remain in PostgreSQL; there is no restore or permanent-erasure UI.
- Every mutation has actor/tenant/action/key-scoped idempotency with a canonical
  input digest. Replays reauthorize and return the current row (including a tombstone
  for a previously successful command), never duplicate events. Changed inputs
  conflict. A new intentional submission gets a new key; recoverable retries reuse it.
- Atomic audit/outbox contains only target ID, version and action, never contact
  names, email, company or search. No feature payload logging.
- Lists use 10/25/50 rows, default 25; encrypted 30-minute actor/tenant/full-query
  cursors. Sort name/company case-insensitively using PostgreSQL C collation or
  creation timestamp, asc/desc with ID in the same direction. Empty companies sort
  last in both directions. Default created desc. Live keyset traversal is not a
  snapshot; changing a sort field may move a contact between pages.
- URL owns search, status, sort, direction and size. In-memory cursor history gives
  Previous; refresh/back/filter changes restart from the first page. No counts.
  Deleting the final row steps back; empty historical pages continue stepping back.
- Frontend feature folder owns copy (en/es), forms, table, hooks, CSS and stories.
  Native modal dialogs supply focus trapping/Escape; all columns/actions remain
  available on mobile through labeled stacked rows. Route and foundation changes
  are wiring only, plus exporting existing transaction/event guards for reuse.

Acceptance: real CRUD; reader/manager/outsider/revoked/assurance/readiness cases;
strict contracts; RLS and same-tenant receipt FK; concurrent replay/stale writes;
all sorts across pages, query/actor/tenant/size cursor mismatch and tampering;
atomic event rollback/expiry; fresh and populated 0007 upgrades; real browser
keyboard, both locales, mobile/dark, recoverable failures and stale responses.
Relevant roadmap IDs: R-TENANCY, R-LIFECYCLE, R-AUTHZ, R-KEYS (rejection), R-SKILLS.
No claim for billing, Phase 3 performance gate or live-agent evaluation acceptance.
