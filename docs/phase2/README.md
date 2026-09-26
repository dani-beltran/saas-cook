# Phase 2: identity, tenancy and authorization primitives

Phase 2 adds mounted Better Auth identity journeys, application-owned organizations and memberships, tenant SQL/RLS, local seat admission, organization/team authorization, transfers and independently authorized owner recovery. The [acceptance record](acceptance.md) tracks the executed checks and their limits against the roadmap. The retained Phase 0 fixtures are not imported by production identity or authorization.

## Start a fresh local installation

Use Node.js 24.19.0, Bun 1.4.2 and Docker. No commercial provider credentials are required.

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run services:up
bun run db:migrate
bun run bootstrap
bun run authz:publish
bun run dev
```

Open [the account page](http://localhost:3000/en/account). Register with a synthetic email address and password, open its verification message in [Mailpit](http://localhost:8026), and explicitly confirm the link. Existing passwordless accounts can continue signing in by email or passkey. Create an organization, invite another registered/verified user, create teams, or transfer ownership to an active member. The initial local policy allows five billable seats. Billing-only memberships are nonbillable; owners/admins/members are billable. Pending invitations consume no seat.

Use the origin configured in `APP_ORIGIN`. Local page visits using the alternate `localhost`/`127.0.0.1` name redirect to that origin before authentication; direct cross-origin authentication requests remain rejected. This keeps cookies, email links and passkeys on the same origin.

The localized account page supports password sign-in, passkeys, authenticator setup, recovery codes, session inventory/revocation and fresh passkey authentication. An email link or password alone never satisfies MFA. When an account has MFA enabled, password and email-link logins must complete their authenticator/recovery challenge before tenant access. Passkey MFA requires verified WebAuthn user verification; an organization requiring MFA must explicitly accept that method. Credential enrollment/removal requires recent authentication, and existing passkeys protect further enrollment from email-only takeover. Password accounts also supply their current password for authenticator setup/removal and recovery-code regeneration. Passwordless accounts continue those operations without a password. Disabling the authenticator requires a registered passkey and fresh MFA, including for password accounts. Keep an independent factor before removing the final passkey.

Forgotten passwords use a separate password-reset request. Its email opens a form without consuming the token; submitting a new password consumes the five-minute, single-use challenge. A successful reset revokes existing sessions, including pending MFA sessions, and pending email/password challenges, then requires sign-in with the new password and any configured MFA. Authenticator credentials, recovery codes and passkeys remain intact. Reset requests return the same acknowledgement for unavailable accounts and passwordless accounts; passwordless users use the existing email recovery journey. Frozen/deleted identities and obsolete credential/recovery epochs cannot reset or sign in.

Organization routes contain the authoritative organization UUID. Each tab keeps its own tenant route; there is no ambient current-organization cookie with authorization meaning. Managers see member emails, invitations, team membership, seat occupancy and transfers, and can remove team members or delete teams. Ownership transfer records the outgoing owner's selected admin/member/billing role or departure; acceptance applies it together with the replacement owner and seat changes. Ordinary members get their own organization summary. Form state remounts on organization navigation. `/en/patterns` and `/es/patterns` retain the synthetic Phase 1 component demonstration.

Invitation and transfer emails point to the selected organization. The recipient must sign in to the matching verified account and explicitly accept. If the link was opened while signed out, sign in and reopen the invitation message. Security-sensitive routes send `no-store` and `no-referrer`; do not configure upstream access logs to retain authentication/invitation query strings.

## Local startup troubleshooting

The development command supervises both Next.js and the worker. If the worker exits, it stops Next.js too. A `worker.startup_failed` event includes an `operation` identifying the startup step and an allowlisted `status`; credentials and raw database errors remain excluded.

| Status | What to check |
| --- | --- |
| `database_missing` | Check the database targets in `.env`. Compose creates `common_saas` for all four application roles and `common_saas_control` for both control roles. Temporary test database names will not survive a service reset. |
| `schema_missing` | On a fresh local installation, run `bun run db:migrate` and `bun run bootstrap`. A missing control schema means bootstrap has not initialized that control database. |
| `connection_failed` | Run `bun run services:up` and check the configured local hosts/ports. |
| `access_denied` | Check the configured role credentials and, for a heartbeat operation, filesystem permissions. |
| `authorization_not_ready` or `binding_mismatch` | Confirm the installation ID and application/control database pairing. Only a fresh installation or recorded interrupted initialization can bootstrap; existing or restored data requires the recovery procedure. |
| `queue_setup_required` | Run `bun run db:migrate` to provision or update the queue under the migration role. |

PostgreSQL, the independent control database and object storage use disposable `tmpfs` storage. Stopping/restarting or recreating their containers erases their data, including custom databases, migrations and bootstrap state. Stopping only `bun run dev` leaves the running services intact. After resetting these disposable services, check `.env` against `.env.example` and repeat:

```sh
bun run services:up
bun run db:migrate
bun run bootstrap
bun run authz:publish
bun run dev
```

Do not rerun bootstrap on an already initialized installation or remove its binding/control records. These fresh-setup steps apply when the disposable data has been lost; existing/restored data follows the [recovery contract](authorization.md).

## Runtime boundaries

| Setting | Process and purpose |
| --- | --- |
| `DATABASE_URL` | Web restricted tenant role; also used by scoped operator commands |
| `IDENTITY_DATABASE_URL` | Web-only identity role for Better Auth credentials/sessions |
| `WORKER_DATABASE_URL` | Worker queue/tenant/mail role; no identity credential access |
| `AUTH_SECRET` | Server-only Better Auth signing and domain-separated email encryption key; at least 32 characters |
| `AUTH_INGRESS_SECRET` | Optional, separate web-only ingress signing key; at least 32 characters; enables verified per-source authentication limits as described below |
| `CONTROL_DATABASE_URL` | Runtime read-only independent publication store |
| `CONTROL_ADMIN_DATABASE_URL` | One-off initialization/operator commands only |
| `MIGRATION_DATABASE_URL` | Reviewed migration and fresh initialization commands only |
| `INSTALLATION_ID` | UUID bound to the independently retained installation receipt |
| `OPENFGA_API_URL` | Trusted OpenFGA endpoint; immutable model/store selected by bootstrap |
| `APP_ORIGIN` | Canonical authentication origin; HTTPS except local development; determines WebAuthn RP hostname |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | SMTP delivery; local defaults target disposable Mailpit |
| `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Optional implicit TLS/authenticated SMTP; credentials require TLS |
| `OWNER_RECOVERY_PUBLIC_KEY` | Dedicated command verification key; see the [operator runbook](authorization.md) |

The independent control database runs on a separate PostgreSQL instance at port 55434. It must retain a separate production recovery lifecycle. The ordinary runtime cannot write independent epochs/readiness or operator approvals. `serve` rejects migration/control administrator credentials; its supervisor removes worker credentials from the web child and identity credentials from the worker child.

`bootstrap` accepts an empty, migrated installation or retries its recorded interrupted initialization. It refuses existing identities, tenants, completed installations and mismatched restored bindings. `authz-publish` validates the immutable model and source-commit readiness; it cannot reopen recovery. Health and mail delivery require matching independent readiness. Existing application data must follow the recovery contract; never delete binding/control records to make bootstrap accept a restored installation.

Authorization uses bounded request-local OpenFGA contexts, fresh organization/epoch/request namespaces, `HIGHER_CONSISTENCY`, sorted user lifecycle fences and shared/exclusive organization fences. Revocation commits source changes and revision updates together. Positive decisions require the actual evaluator. Every tenant SQL transaction sets and clears context on the same pooled connection. All tenant tables force RLS, composite foreign keys prevent cross-tenant references, and runtime roles cannot run DDL or truncate tables. See [the authorization and recovery runbook](authorization.md).

Identity and tenant email intents enter an encrypted, short-lived database outbox. The worker claims rows with `SKIP LOCKED`, uses bounded SMTP timeouts/retry, and clears payloads after delivery, expiry or final failure. SMTP is at-least-once with a stable Message-ID; it does not promise recipient-side exactly-once delivery. Verification, password reset, passwordless recovery-entry, magic-link, invitation, transfer and owner-recovery templates render in English/Spanish. Password-reset messages explicitly preserve MFA requirements. Domain notifications currently use the English default; identity requests carry the selected locale. No password, token or email body is logged.

## Authentication ingress and security recording

Registration, magic-link and recovery requests, including password reset, use shared PostgreSQL rate limits: five requests per email, twenty per source, and one hundred across the installation per minute. Password sign-in is also limited per identity and source. The source bucket is checked first, so one source cannot exhaust the installation allowance by rotating email addresses. Bucket identifiers are keyed hashes. The application never treats `Forwarded`, `X-Forwarded-For` or an unsigned source header as authoritative.

For a production reverse proxy, configure a dedicated `AUTH_INGRESS_SECRET` on the web process and trusted ingress. The ingress must remove caller-supplied `x-common-saas-source`, `x-common-saas-source-time` and `x-common-saas-source-signature` headers before setting its own. Derive the client address from the verified network peer or the ingress provider's authenticated connection metadata. Use canonical IPv4 or lowercase compressed IPv6 without brackets. Set the time to decimal Unix seconds and sign the following UTF-8 string with HMAC-SHA256, returning lowercase hexadecimal in the signature header:

```text
common-saas-ingress:v1
<unix seconds>
<HTTP method>
<URL pathname without query>
<canonical client IP>
```

There is no trailing newline. The source and time go in the corresponding headers. Proofs expire after thirty seconds and allow at most five seconds of future clock skew. With a signing key configured, absent, invalid or expired proofs produce the same generic response without issuing mail, so direct-origin requests cannot bypass the source limit. Keep this key distinct from `AUTH_SECRET`; the supervisor excludes it from the worker and it is never sent to the browser. Without a key, local development uses one shared unattributed source bucket, regardless of spoofed headers; this intentionally limits the entire local instance to twenty authentication requests per minute. Configure the signed ingress before serving multiple production clients.

Failed identity actions emit fixed security event codes through the shared redacted logger, using server-generated request correlation. Failures attributable to a verified session also enter `identity.security_audit`. Anonymous recording has a shared one-hundred-events-per-minute budget; each verified actor has a separate twenty-events-per-minute budget, so anonymous traffic cannot suppress that actor's audit. Credential values, email addresses, source addresses, request bodies and authentication URLs are excluded.

Better Auth provider endpoints also ignore forwarding headers for throttling and use the verified ingress source plus route. Valid signed sources have independent buckets; missing or invalid proofs share an unattributed bucket for provider endpoints. The configured mail-request endpoints still return a generic no-op for invalid proofs. Provider buckets use atomic admission with endpoint-specific windows and keyed hashes. Each process removes up to 1,000 provider buckets inactive for at least twenty-four hours, at most once per minute, without waiting for rows locked by other requests.

## Verify

```sh
bun run check
bun run typecheck
bun run knip
bun run test:unit
bun run test:integration
bun run authz:validate
bun run build
bun run test:e2e
bun run storybook:build
bun run image:build
bun run test:image
bun run security:scan dependencies
bun run security:scan image common-sass:phase2
```

Integration tests use isolated databases, actual restricted roles, real OpenFGA and local SMTP. Browser tests use a dedicated port 3102 and create a fresh migrated application/control installation for real registration, explicit confirmation and Chromium WebAuthn credentials; teardown removes only that run's fixture. The worker integration test also owns its database rather than relying on the current local application's state. The built image tests create disposable databases and verify fresh/interrupted/existing/restored initialization, readiness, process supervision and shutdown. Reports live under ignored `artifacts/`; selected evidence is retained beside the acceptance record. Hosted CI still requires a repository push and is not implied by local results.

Phase 3 extends this protocol to resources, workspaces and service principals. Phase 6 owns full application-restore credential replacement, independent deletion-journal replay and security revalidation. Phase 2 owner recovery is scoped organizational authority recovery; it cannot release a restored application's global readiness gate.
