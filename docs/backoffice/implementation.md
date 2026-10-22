# BO-01/02-S1 implementation and operation

Status: first slice implemented; release acceptance remains pending. [BO-00 decisions](bo-00.md) select the development defaults and list the external deployment/security decisions. No production staff, signing keys, migrations or infrastructure were provisioned.

## Scope and boundaries

`apps/backoffice` serves English/Spanish public staff sign-in, invited user-verified passkey enrollment, sign-out, exact-ID organization lookup and a bounded organization directory. `packages/backoffice-contracts` allowlists input/output; `packages/backoffice` composes restricted services. `packages/auth/src/operator` owns separate Better Auth tables, cookies and ceremonies; `packages/authz/src/platform` owns a distinct pinned model/publication. No customer session, tenant role or API key grants staff access.

The staff workspace loads the shared UI stylesheet through the same pinned Tailwind/PostCSS pipeline as the customer app. Shared buttons, inputs, language selector, cards, badges and notices use Foundation theme tokens and system light/dark appearance. The responsive shell follows the customer dashboard's sidebar, typography and spacing without importing its customer identity runtime. English/Spanish forms include field guidance, keyboard submission, a skip link, pending/invalid/denied feedback and an empty/result overview. Backoffice presentation stories are included in the existing Storybook workspace.

The query returns ID, name, lifecycle, local occupied/capacity seats, source timestamp and audit reference. It never returns customer contents, accounts, emails or unrestricted totals. Unknown and unauthorized organization IDs have the same external failure. The directory is restricted to exact organization grants; there is no global-account search, projection worker, finance/privacy action, support delegation or self-service privilege editor.

The Next adapter restores the configured public origin only when the Host header exactly matches that origin. Forwarded host/protocol never select the trusted origin. Staff sign-in is publicly reachable without custom proxy headers or an IP allowlist. Non-read requests require the exact Origin; bearer credentials remain unsupported. Source/forwarding headers are ignored for authorization and rate limiting. Cloudflare deployment is outside project scope. `/health/live` is payload-free liveness; `/health/ready` returns only readiness status after checking roles, schema/publication and FGA.

Cookies are host-only, HttpOnly, SameSite=Strict; HTTPS uses `__Host-backoffice-session` and Secure, while loopback test/development uses `backoffice-session`. Sessions have eight-hour absolute and thirty-minute idle limits. No HTTP production origin is accepted. Authentication exposes only allowlisted passkey endpoints and sign-out; provider token/credential JSON is never returned on successful verification. The database-backed admission counter allows 60 protected requests per minute across all callers and replicas; failed ceremonies consume admission too. The fixed shared key cannot be reset by changing headers. Staff share this conservative budget, so one caller can exhaust it for the current minute; it stores no source IP. Expired ceremony cleanup is bounded per request.

Lookup holds independent recovery and operator shared fences, then the existing organization fence; offboarding/re-enrollment takes the operator fence exclusively. Forced row-level security constrains query-role grants to the current operator, organization, epoch and environment. Exact grants are immutable through HTTP and replaced only by independent signed management. The read audit commits before disclosure; a deferred database expiry trigger guards successful read commits. Failed lookup attempts audit separately. Restored epochs never renew staff authority automatically.

## Setup and commands

1. Provision three restricted application roles: `saas_cook_bo_identity`, `saas_cook_bo_query`, `saas_cook_bo_manager`, all non-owner/non-superuser/non-BYPASSRLS with database CONNECT. Disposable Compose init creates these; existing installations require an administrator to provision them explicitly, without replaying development init scripts.
2. Apply reviewed migration `0025_backoffice_identity` with the existing migrator. It adds `operator_identity` and `backoffice`, explicit grants, one fixed metadata function and a deferred expiry trigger. It changes no existing customer rows or readiness. Schema snapshots/journal are additive. The metadata function exposes only the six declared fields and uses the existing organization lock; BO query credentials have no customer table SELECT privilege.
3. Run existing `control:schema` with the control administrator, then `backoffice:publish` with `CONTROL_ADMIN_DATABASE_URL`, `INSTALLATION_ID` and `OPENFGA_API_URL`. Publication does not change customer readiness. A new epoch requires re-publication and independently approved staff re-enrollment; it never stamps new epochs onto restored credentials/grants.
4. Configure the commented Backoffice values in `.env.example` plus the existing restricted control-reader URL and installation/FGA values. The BO web process must not receive customer auth, management, migration or recovery credentials.
5. Use `bun run dev:backoffice` directly at `http://localhost:3001` with that `BACKOFFICE_ORIGIN`, or `bun run build:backoffice` then `bun run start:backoffice` with the appropriate PORT/HOSTNAME. Direct unsigned browser access is supported. The isolated HTTPS browser runner uses a synthetic TLS adapter; staff access still requires an invited verified passkey.
6. Build `bun run image:build:backoffice` and verify `bun run test:image:backoffice`. The default Docker target remains customer `app`; `backoffice` serves only Next with bounded startup validation/drain. The BO image has its own tag and digest. Customer and BO builds are independent, using the same frozen workspace install.

## Independent staff management

The one-off `bun run backoffice:manage APPROVAL_FILE PRIVATE_OUTPUT_FILE` requires the separate manager URL, restricted control reader, installation/environment and two distinct Ed25519 public-key files. Signing keys are retained externally; no web endpoint signs or executes this command. Assign named custodians before deployment. Both must independently verify staff identity, intended organization scope and the case reference. This authority is separate from existing signed customer recovery/deactivation and cannot release customer readiness.

The JSON envelope has exactly `payload`, `sponsor`, `security`: payload is base64url-encoded UTF-8 JSON; the other fields are base64url Ed25519 signatures over those exact payload bytes. Claims are:

- `version: 1`, UUID `nonce`, `installationId`, `epoch`, and `environment` (`development`, `test`, `production`).
- `expiresAt` no later than five minutes from execution; `action` is `invite`, `offboard` or explicit `reenroll`.
- UUID `operatorId`, independently verified `email`, bounded `name`, one to twenty exact UUID `organizationIds`, `grantExpiresAt` within ninety days, and an identifier-only `caseReference` (maximum eighty characters).

Every command binds these fields, consumes its nonce once and records both approver public-key fingerprints in audit. `invite` refuses existing identities; `offboard` disables the operator and deletes sessions/grants/invitations. `reenroll` explicitly replaces credentials, sessions and scopes after independent verification; it is the recovery path for a lost/expired invitation or restored staff record. It never trusts an old passkey or email proof. Even unused fields remain signed for offboarding; they cannot change its fixed disabling behavior.

The output file is created exclusively with mode 0600 before effects. Invitations are random, stored only as hashes and expire within fifteen minutes. Transfer the code through the independently verified staff onboarding channel; no email is sent by this implementation. Never put it in a URL, issue, log or repository. If interrupted after commit but before durable delivery, do not replay the consumed nonce: obtain a new explicit re-enrollment approval. The resulting passkey must verify the user's presence and local factor before staff access is available.

## Compatibility, rollout and rollback

Initial supported pair: current customer source with additive application schema through `0026` for the directory binary, current customer model unchanged, BO protocol v1 with the exact operator model hash stored independently. Future application schemas must be explicitly reviewed before extending the compatibility range. There is no previous released BO version to claim tested. Customer-only operation requires no BO process, credentials or publication; old customer code tolerates the additive schemas. The customer image intentionally retains its reviewed operator CLI commands; these are not BO HTTP routes.

Deploy schemas/control extension first, publish operator model, then BO with access limited to invited synthetic staff to synthetic identities before the named staff cohort. Stop/remove the BO deployment to roll back; retain audit and management receipts and revoke staff sessions as needed. Never undo migrations, reset readiness or restore credentials as rollback. An operator-model change must independently invalidate BO readiness without changing customer publication.

## Verification

Executed evidence and limitations are recorded in [verification](acceptance.md). Tests cover schema/role isolation, audited scope denial, late FGA allow after expiry, offboarding fences, epoch invalidation, real browser passkey enrollment/sign-in and localized states. Additional image, current customer regression and release checks must be reported as executed, failed or pending; no smoke or historical image stands in for the current pair.


## Public access evolution — 2026-10-22

Remove `BACKOFFICE_INGRESS_SECRET` and `BACKOFFICE_CIDRS` from Backoffice configuration; they are no longer consumed. No new migration, model publication or credential re-enrollment is needed when the origin/RP ID stays the same. Existing rate rows are harmless and unused; audit history is retained. A changed WebAuthn RP hostname requires separately approved enrollment for that hostname. The customer application's independent ingress configuration is unchanged. Local development needs no signing proxy; the HTTPS browser fixture uses only a test TLS adapter.

## Scoped organization directory — BO-02.1

The workspace also offers `POST /api/organizations/directory`, using strict
`packages/backoffice-contracts` schemas and the restricted service in
`packages/backoffice/src/directory.ts`. Apply reviewed migration
`0026_backoffice_directory` before starting the directory binary. It preserves
existing rows and grants, adds an indexed own-scope RLS path, extends deferred
expiry guarding to empty and populated directory pages, and advances compatibility
to the reviewed schema through 0026. The old lookup app can run against that
additive schema; the new app requires its directory compatibility function.

Only approved exact organizations are candidates. The table shows their full organization names under the same scoped read permission and audit boundary. UUID/lifecycle filters, UUID ordering,
1–50 rows and up to 200 scanned candidates bound requests. The existing signed
manager's 20-organization assignment limit is unchanged; a defensive 200-grant-row
scope ceiling rejects unsupported assignments. Current grants, FGA, publication
and the earliest expiry are checked for each page under the existing fences.
Expired or modified scopes invalidate continuation; no unrestricted totals exist.

Directory cursors are authenticated encrypted, purpose-separated from staff
sessions, bound to the current actor/session/scope/query and valid at most five
minutes. Empty filtered pages may offer continuation. The English/Spanish UI
clears results on changed filters, authentication actions and failed requests.
Per-row source timestamps and the page check time describe live observations;
refresh rechecks data. No directory worker, copied customer data or projection
freshness assumption is introduced. See the [evolution decision](../feature-briefs/backoffice.md#bo-021-directory-evolution--2026-10-22)
for the exact field and compatibility contract.

## Signed-out workspace gating — 2026-10-22

The initial page renders only staff sign-in/enrollment while a no-store
`POST /api/session` checks the existing verified identity boundary. It returns
204 for a current staff session and 403 for missing/expired/unavailable authority,
without identity details. Existing proxy origin rejections occur before this route.
The directory, lookup, overview and organization navigation mount only after that
check succeeds. Reload restores the authenticated workspace; sign-out immediately
unmounts it and clears displayed results. Window focus and protected-query failures
recheck the session, hiding tools when authority is lost. Server authorization
remains mandatory for every protected read; UI state never supplies authority.
No migration, permission model or credential change is required for this UI fix.

Authenticated Organizations at `/{locale}` shows directory, lookup and overview.
Staff session controls live separately at `/{locale}/staff-access`, reached through
the sidebar. The shared session controller gates each route; signed-out visitors
receive sign-in/enrollment. The language selector retains the selected page.

## Organization table and audited row details — 2026-10-22

The directory presents assigned organizations in a semantic table with full organization
name, UUID, lifecycle, row observation time and View details. Previous/Next controls
replay the page's actor/scope/query-bound cursor requests, retaining empty-page
continuations and server page limits. Filters or case-reference changes start a
new query. No totals or additional fields are exposed.

View details issues a fresh request to the existing audited exact-ID lookup with
the selected UUID and the directory query's validated case reference. The service
rechecks current scope, session, epoch and audit before returning metadata. The
overview receives keyboard focus when the request completes; loading/denied
feedback clears prior detail data. The table remains on its current page. The
manual ID lookup is a collapsed secondary shortcut below the overview, using the
same lookup handler. Both workflows remain read-only and require a case reference.

## Dedicated organization detail page — 2026-10-22

Organization overview is now at `/{locale}/organizations/{organizationId}`.
Directory View details and the secondary ID shortcut navigate there. The directory
page contains its table and shortcut, with no inline organization overview.

The case reference is handed off through per-tab session storage, never in the
URL; no organization metadata or authorization result is cached there. The detail
page verifies the current staff session and performs a fresh no-store request to
the existing audited lookup. Reload rechecks and audits again. A direct visit
without a valid case reference asks for one before requesting data. Session loss
clears visible details; missing/wrong scope remains denied by the server. The
organization ID is read-only in the detail request form. A localized Back to
organizations link and the sidebar return to the directory; locale changes retain
the selected detail route. No schema or permission model change is required.
