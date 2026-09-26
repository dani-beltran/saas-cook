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

Open [the account page](http://localhost:3000/en/account). Register a synthetic email address, open its message in [Mailpit](http://localhost:8026), and explicitly confirm the link. Create an organization, invite another registered/verified user, create teams, or transfer ownership to an active member. The initial local policy allows five billable seats. Billing-only memberships are nonbillable; owners/admins/members are billable. Pending invitations consume no seat. Password authentication is disabled; there is no password-reset endpoint that can bypass passwordless recovery.

The localized account page supports passkeys, authenticator setup, recovery codes, session inventory/revocation and fresh passkey authentication. An email link never satisfies MFA. When an account has MFA enabled, an email login must complete its authenticator/recovery challenge before tenant access. Passkey MFA requires verified WebAuthn user verification; an organization requiring MFA must explicitly accept that method. Credential enrollment/removal requires recent authentication, and existing passkeys protect further enrollment from email-only takeover. Keep an independent factor before removing the final passkey.

Organization routes contain the authoritative organization UUID. Each tab keeps its own tenant route; there is no ambient current-organization cookie with authorization meaning. Managers see member emails, invitations, teams, seat occupancy and transfers; ordinary members get their own organization summary. Form state remounts on organization navigation. `/en/patterns` and `/es/patterns` retain the synthetic Phase 1 component demonstration.

Invitation and transfer emails point to the selected organization. The recipient must sign in to the matching verified account and explicitly accept. If the link was opened while signed out, sign in and reopen the invitation message. Security-sensitive routes send `no-store` and `no-referrer`; do not configure upstream access logs to retain authentication/invitation query strings.

## Runtime boundaries

| Setting | Process and purpose |
| --- | --- |
| `DATABASE_URL` | Web restricted tenant role; also used by scoped operator commands |
| `IDENTITY_DATABASE_URL` | Web-only identity role for Better Auth credentials/sessions |
| `WORKER_DATABASE_URL` | Worker queue/tenant/mail role; no identity credential access |
| `AUTH_SECRET` | Server-only Better Auth signing and domain-separated email encryption key; at least 32 characters |
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

Identity and tenant email intents enter an encrypted, short-lived database outbox. The worker claims rows with `SKIP LOCKED`, uses bounded SMTP timeouts/retry, and clears payloads after delivery, expiry or final failure. SMTP is at-least-once with a stable Message-ID; it does not promise recipient-side exactly-once delivery. All verification, reset/recovery-entry, magic-link, invitation, transfer and owner-recovery templates render in English/Spanish. Domain notifications currently use the English default; identity requests carry the selected locale. No token or email body is logged.

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

Integration tests use isolated databases, actual restricted roles, real OpenFGA and local SMTP. Browser tests use a dedicated port 3102 and real registration, explicit confirmation and Chromium WebAuthn credentials. The built image tests create disposable databases and verify fresh/interrupted/existing/restored initialization, readiness, process supervision and shutdown. Reports live under ignored `artifacts/`; selected evidence is retained beside the acceptance record. Hosted CI still requires a repository push and is not implied by local results.

Phase 3 extends this protocol to resources, workspaces and service principals. Phase 6 owns full application-restore credential replacement, independent deletion-journal replay and security revalidation. Phase 2 owner recovery is scoped organizational authority recovery; it cannot release a restored application's global readiness gate.
