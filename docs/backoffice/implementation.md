# BO-01/02-S1 implementation and operation

Status: first slice implemented; release acceptance remains pending. [BO-00 decisions](bo-00.md) select the development defaults and list the external deployment/security decisions. No production staff, signing keys, migrations or infrastructure were provisioned.

## Scope and boundaries

`apps/backoffice` serves English/Spanish private staff sign-in, invited user-verified passkey enrollment, sign-out and a single exact-ID organization lookup. `packages/backoffice-contracts` allowlists input/output; `packages/backoffice` composes restricted services. `packages/auth/src/operator` owns separate Better Auth tables, cookies and ceremonies; `packages/authz/src/platform` owns a distinct pinned model/publication. No customer session, tenant role or API key grants staff access.

The query returns ID, name, lifecycle, local occupied/capacity seats, source timestamp and audit reference. It never returns customer contents, accounts, emails or unrestricted totals. Unknown and unauthorized organization IDs have the same external failure. There is no general search, projection worker, finance/privacy action, support delegation or self-service privilege editor.

The Next adapter restores the configured public origin after TLS termination only when the Host header exactly matches that origin. Forwarded host/protocol never select the trusted origin. Network admission requires a fresh HMAC-SHA256 assertion, including in local development. Ingress signs UTF-8 `backoffice-ingress:v1\nORIGIN\nMETHOD\nPATH_AND_QUERY\nUNIX_SECONDS\nCANONICAL_SOURCE_IP` with `BACKOFFICE_INGRESS_SECRET`; send lowercase hex in `x-backoffice-signature`, alongside `x-backoffice-time` and `x-backoffice-source`. Strip incoming versions of these headers at the trusted ingress. Direct-origin isolation, TLS/VPN and network/key-policy review remain deployment requirements. Merely supplying forwarding headers grants nothing. `/health/live` is payload-free liveness; `/health/ready` requires ingress proof and checks roles, schema/publication and FGA.

Cookies are host-only, HttpOnly, SameSite=Strict; HTTPS uses `__Host-backoffice-session` and Secure, while loopback test/development uses `backoffice-session`. Sessions have eight-hour absolute and thirty-minute idle limits. No HTTP production origin is accepted. Authentication exposes only allowlisted passkey endpoints and sign-out; provider token/credential JSON is never returned on successful verification. The database-backed admission counter is a bounded HMAC bucket, so collisions conservatively share a rate limit; it stores no source IP. Expired ceremony cleanup is bounded per request.

Lookup holds independent recovery and operator shared fences, then the existing organization fence; offboarding/re-enrollment takes the operator fence exclusively. Forced row-level security constrains query-role grants to the current operator, organization, epoch and environment. Exact grants are immutable through HTTP and replaced only by independent signed management. The read audit commits before disclosure; a deferred database expiry trigger guards successful read commits. Failed lookup attempts audit separately. Restored epochs never renew staff authority automatically.

## Setup and commands

1. Provision three restricted application roles: `saas_cook_bo_identity`, `saas_cook_bo_query`, `saas_cook_bo_manager`, all non-owner/non-superuser/non-BYPASSRLS with database CONNECT. Disposable Compose init creates these; existing installations require an administrator to provision them explicitly, without replaying development init scripts.
2. Apply reviewed migration `0025_backoffice_identity` with the existing migrator. It adds `operator_identity` and `backoffice`, explicit grants, one fixed metadata function and a deferred expiry trigger. It changes no existing customer rows or readiness. Schema snapshots/journal are additive. The metadata function exposes only the six declared fields and uses the existing organization lock; BO query credentials have no customer table SELECT privilege.
3. Run existing `control:schema` with the control administrator, then `backoffice:publish` with `CONTROL_ADMIN_DATABASE_URL`, `INSTALLATION_ID` and `OPENFGA_API_URL`. Publication does not change customer readiness. A new epoch requires re-publication and independently approved staff re-enrollment; it never stamps new epochs onto restored credentials/grants.
4. Configure the commented Backoffice values in `.env.example` plus the existing restricted control-reader URL and installation/FGA values. The BO web process must not receive customer auth, management, migration or recovery credentials.
5. Use `bun run dev:backoffice` behind a signing development ingress, or `bun run build:backoffice` then `bun run start:backoffice` with the appropriate PORT/HOSTNAME. A direct unsigned browser request is intentionally unavailable. The isolated browser runner supplies synthetic ingress assertions; it is not a production proxy.
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

Initial supported pair: current customer source with additive application schema through `0025`, current customer model unchanged, BO protocol v1 with the exact operator model hash stored independently. Future application schemas must be explicitly reviewed before extending the compatibility range. There is no previous released BO version to claim tested. Customer-only operation requires no BO process, credentials or publication; old customer code tolerates the additive schemas. The customer image intentionally retains its reviewed operator CLI commands; these are not BO HTTP routes.

Deploy schemas/control extension first, publish operator model, then private BO dark to synthetic identities before the named staff cohort. Stop/remove the BO deployment and ingress to roll back; retain audit and management receipts and revoke staff sessions as needed. Never undo migrations, reset readiness or restore credentials as rollback. An operator-model change must independently invalidate BO readiness without changing customer publication.

## Verification

Executed evidence and limitations are recorded in [verification](acceptance.md). Tests cover schema/role isolation, audited scope denial, late FGA allow after expiry, offboarding fences, epoch invalidation, real browser passkey enrollment/sign-in and localized states. Additional image, current customer regression and release checks must be reported as executed, failed or pending; no smoke or historical image stands in for the current pair.
