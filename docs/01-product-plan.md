# 1. Product plan

## 1.1 Objective and assumptions

Build a reusable B2B SaaS starting point that removes repeated platform work while leaving product-specific features easy to implement. It should support a small self-service product and offer a clear path to enterprise customers without replacing its security or billing foundations.

Initial assumptions:

- One application serves many customer organizations. One organization is one tenant and initially one billing account.
- A global user can join multiple organizations with different permissions in each.
- A workspace is an optional subdivision of an organization, not a separate billing or isolation boundary.
- The template is source code developers own and customize. It is not a runtime no-code application builder.
- Products can disable optional modules. Tenant isolation, authorization, validation, and security audit cannot be disabled for convenience.
- A demonstration Projects feature proves the architecture and agent-assisted development workflow; it is removable from products that do not need projects.
- Use the complete [required technology stack](02-architecture-and-security.md#21-stack-decisions) across all presets; the roadmap assigns its setup and feature integration to explicit phases.

Release labels below are **F — foundation**, **C — commercial core**, **E — enterprise baseline**, and **X — optional extension**. E features are required before presenting the release as the enterprise template, even though they are delivered after F and C.

## 1.2 Capability catalogue

### Identity, organizations, and access

| Capability | Required behavior | Release |
| --- | --- | --- |
| Registration and sign-in | Email/password registration, email verification, password reset with preserved MFA/recovery, secure sessions, generic account-discovery responses, optional social login | F |
| Email magic links | Passwordless email sign-in, short-lived single-use tokens, generic responses, safe redirects, rate limits, and organization-policy enforcement | F |
| Passkeys | WebAuthn registration/sign-in, multiple named credentials, revoke/replace, verified origins/RP ID, user verification, and tested recovery | F |
| Account security | MFA, recovery codes, session inventory, revoke one/all sessions, sensitive-action reauthentication | F |
| Personal account deletion | Self-service global-account closure, ownership resolution in every organization, credential revocation, resumable purge/anonymization, and provider cleanup; continuing tenant data/billing preserved | C |
| Organizations | Create, rename, switch, configure, suspend; stable IDs independent of slugs; export/deletion arrive in C | F/C |
| Memberships | Invite, resend, expire, accept, remove, suspend, transfer ownership; voluntary changes preserve an active owner, security deprovisioning can enter owner recovery | F |
| Organization ownership transfer | Nominate an eligible verified active member, recipient acceptance, atomic owner-role transition and seat checks, expiry/cancel, notifications, and audit; used by account deletion | F |
| Organization onboarding | Checklist, profile, first resource, invitation, local foundation policy, completion tracking; paid plan/trial selection arrives in C | F/C |
| Teams and workspaces | Team membership in Phase 2; optional workspace CRUD/archive and resource grouping/inherited access in Phase 3, with same-tenant move and revocation tests | F |
| Tenant isolation | Tenant-scoped database access, storage, caches, search, jobs, exports, and integrations | F |
| ReBAC | Parent-child inheritance, direct sharing, team access, per-resource viewer/editor/manager relations | F |
| Roles | Owner, administrator, member, billing manager, and resource viewer defaults; roles assign capabilities through the relationship model | F |
| Custom roles | Organization-defined permission bundles from a platform-controlled catalogue; no arbitrary executable policies | E |
| Guest access | Explicit limited organization membership and resource grants; expiry and separate seat rules | E |
| Enterprise SSO | Organization-specific OIDC/SAML connections, verified domains, enforced SSO, controlled account linking | E |
| Directory provisioning | SCIM users/groups, idempotent sync, organization-scoped deprovisioning, directory ownership rules | E |
| Security policies | Require MFA/SSO, session lifetime, invitation restrictions, approved domains, optional IP allowlist | E |
| Service identities | Organization-owned service accounts and expiring, scoped, revocable API keys; enforcement and tested provisioning commands in F, customer administration UI in C | F/C |

### Commercial features

| Capability | Required behavior | Release |
| --- | --- | --- |
| Product and plan catalogue | Stable feature keys, versioned plans, monthly/annual prices, currencies, included quotas, add-ons | C |
| Subscription lifecycle | Checkout, trials, upgrades, scheduled downgrades, renewals, cancellation, resumption, delinquency | C |
| Billing administration | Billing contacts, company details, tax identifiers, payment methods, invoices, hosted customer portal | C |
| Seat billing | Explicit seat eligibility, provider-confirmed capacity and reconciliation; one admission boundary for invitations, reactivation, provisioning, and role changes | C |
| Entitlements | Typed local policy resolver in F; sold-plan/add-on sources in C and negotiated overrides in E, independent of permissions | F/C/E |
| Usage metering | Durable events, deduplication, unit definitions, period totals, corrections, reconciliation | C |
| Quotas | Transactional capacity reservations and membership admission in F; windowed usage, soft limits, warnings, and billing integration in C | F/C |
| Product analytics | Typed product events, user/organization attribution, onboarding/conversion funnels, feature adoption and retention reports, tracking controls, and provider deletion; separate from billable usage | C |
| Usage dashboard | Current usage, limits, reset date, reporting delay, alerts; clearly distinguish estimated charges | C |
| Billing resilience | Signature verification, durable webhook inbox, retries, out-of-order handling, scheduled reconciliation | C |
| Sales-led contracts | Manual invoicing mode, negotiated entitlements, effective dates, audit trail, renewal metadata | E |
| Advanced usage charging | Usage provider adapter, hybrid pricing, prepaid credits, minimum commitments, overages | X |
| Revenue reporting | Operational MRR/ARR and churn views with documented definitions; accounting integrations later | X |

### Application and customer experience

| Capability | Required behavior | Release |
| --- | --- | --- |
| Dashboard shell | Organization switcher, navigation, breadcrumbs, global commands, account menu, responsive layout | F |
| Reusable CRUD experience | Feature-local search, filters, sorting, cursor pagination, create/edit/detail screens, authorized actions, confirmation dialogs; Project list search ships in Phase 3 | F |
| Accessibility and themes | Keyboard navigation, focus management, semantic labels, contrast, reduced motion, light/dark themes | F |
| State handling | Loading, empty, error, unavailable, denied, validation, stale-update conflict, and quota states | F |
| Internationalization | next-intl translation keys, locale-aware numbers/dates, time zones, currency formatting; English seed catalogue | F |
| User preferences | Profile, avatar, locale, time zone, notifications, sessions, MFA | F/C |
| Transactional notifications | React Email templates for verification/reset/magic-link/invitation/ownership-transfer and security/recovery delivery in F; full email/in-app preferences and commercial notices in C | F/C |
| Files | Private uploads, immutable scanned bytes, signed access, type/size checks, quarantine/scanning, storage quotas | C |
| Search | Cross-resource PostgreSQL search in Phase 6 over registered, enabled resource types; permission-aware results, snippets and counts; distinct from Foundation feature-local list search | C |
| Import/export | Validated CSV imports, preview/errors, resumable bulk processing, authorized downloadable exports | C |
| Activity history | Customer-visible resource activity feeds in Phase 6, projected from allowlisted domain events with current resource permissions; separate from restricted security audit | C |
| Public website | Branding, landing/pricing page, sign-in, product links, legal-page placeholders, basic SEO metadata | C |
| Help and support | Contextual help links, diagnostics/reference IDs, support contact, changelog entry point | C |
| Custom domains/branding | Domain ownership checks, certificates, tenant branding, safe host routing | X |
| Realtime collaboration | Presence and event updates with server-checked channel subscriptions | X |

### Platform, integrations, and operations

| Capability | Required behavior | Release |
| --- | --- | --- |
| Versioned API | oRPC typed contracts/clients with Zod validation, public REST/OpenAPI adapter, pagination, rate limits, consistent errors | F/C |
| AI agent skills | Bootstrap, add/evolve a domain feature, add a dashboard page or email, and verify a change using AGENTS.md context, existing services, reviewable diffs, and executable checks | F |
| Developer experience | Bun workspaces; Storybook components; Biome lint/format; Commitlint conventions; Lefthook hooks; Knip cleanup; Vitest unit tests and Playwright end-to-end tests | F |
| Background processing | Durable jobs, retries, concurrency limits, timeouts, scheduling, dead-letter handling | F |
| Domain events | Transactional outbox, versioned payloads, idempotent consumers | F |
| Integration credentials | Encrypted secrets, minimum scopes, refresh/revocation lifecycle, connection health | C |
| Outgoing webhooks | Signed versioned events, endpoint verification, retries, delivery history, secret rotation | C |
| Audit logs | Actor, organization, action, target, result, timestamp, request ID, redacted changes; controlled export | F/C |
| Feature flags | Platform rollout switches separate from paid entitlements, safe targeting, kill switches, expiry owner | C |
| Operator console | Tenant health, job/reconciliation failures, suspension, plan overrides, controlled support sessions | E |
| Observability | LogTape structured logs, OpenTelemetry traces/metrics, error tracking, queue lag, isolation alerts, usage discrepancies | F/C |
| Build tooling | Local dependencies, seed data, GitHub Actions CI, combined Docker image, migration command packaging and release/version policy | F |
| Data lifecycle | Personal account deletion and organization export/deletion, independent deletion journal for both scopes, analytics-provider cleanup, baseline retention/backup expiry in C; advanced retention and legal-hold hooks in E | C/E |
| Recovery | Application readiness gates, independent journal replay, credential replacement and security revalidation; synthetic recovery tests in C and expanded fault cases in E | C/E |
| Security engineering | Threat model, dependency/secret scanning, restricted DB roles, security regression suite | F/E |

## 1.3 Essential product journeys

1. **Start a company account:** sign up → verify email → create organization → atomically initialize capacity and admit owner membership → select the local foundation policy or commercial plan/trial → create first Project → invite a teammate. Provisioning is resumable and must not leave a usable tenant with missing security initialization.
2. **Join a company:** follow a single-use invitation → authenticate as its intended verified identity → validate organization policy and seat capacity → accept atomically → obtain only the assigned access. Redirect back to the requested resource safely.
3. **Work in multiple companies:** switch organizations → resolve a fresh tenant context → clear tenant-specific client state → display only the selected organization's data. Two tabs may use different organizations without silently changing each other's mutation target.
4. **Share a resource:** manager assigns a team or member → change is audited → a verified authorization generation becomes current → recipient can access it. Show pending authorization readiness distinctly from a failed mutation. Revocation takes effect before a new operation can use an obsolete grant, including after a delayed projector request completes.
5. **Upgrade a plan:** billing manager previews change → provider checkout/update → verified server-side billing state updates → entitlements become available → dashboard reflects the result. A checkout success URL alone cannot activate paid access.
6. **Hit a limit:** operation is refused before consuming unavailable capacity → clear explanation shows current usage and reset/upgrade path → existing read access follows documented policy.
7. **Offboard an employee:** deactivate membership → revoke that organization's access and relevant tokens → remove team grants → transfer required resource responsibilities → reconcile seats → retain the user's access to other organizations. Security/SCIM deprovisioning proceeds even for the sole owner; atomically enter owner recovery and freeze ordinary tenant activity until a verified replacement is admitted. Preserve historical actor references with the configured privacy policy.
8. **Leave the service (C):** owner requests export → receives scoped, expiring download → schedules deletion → the independent deletion journal durably records the request → cancellation and retention rules run → deletion status remains visible through a minimal recovery channel. Recovery from an older backup replays that journal before serving tenant traffic.

9. **Sign in without a password:** request an email magic link or use a registered passkey → verify the single-use challenge → resolve identity → satisfy the target organization's SSO/MFA policy → establish a session. Expired/replayed links and invalid origins fail safely; recovery never silently weakens tenant policy.
10. **Transfer organization ownership:** current owner reauthenticates → selects an eligible existing member → recipient accepts with fresh authentication → shared membership transition atomically promotes the recipient and applies the agreed outgoing role → audit and notify both parties. A pending invitation or transfer is not completed ownership.
11. **Delete a personal account (C):** reauthenticate → list all affected memberships and ownership obligations → complete accepted transfers or finish separately authorized organization deletion → confirm → journal deletion and freeze the global identity → revoke credentials/access → clean up personal data and analytics identifiers → show completion through a minimal recovery channel. Other users retain their organizations, resources, and subscriptions; retry partial failures without duplicating seat changes.
12. **Understand adoption (C):** product operator views onboarding completion, activation, feature adoption, paid conversion, and retention using documented event/report definitions. Test traffic is separated; tracking settings and deletion are respected; product analytics never decides billing or permissions.

## 1.4 Dashboard information architecture

Proposed browser routes, with `[orgSlug]` resolved to an authorized immutable organization ID:

```text
/login, /signup, /verify-email, /forgot-password, /reset-password
/auth/magic-link                         # Confirmation/redemption flow
/onboarding
/invite/[token]
/account/profile
/account/security                       # Includes passkey management
/account/delete                         # Ownership checklist and deletion status
/account/notifications
/app/[orgSlug]/overview
/app/[orgSlug]/projects                   # Reference feature used by agent skills
/app/[orgSlug]/projects/new
/app/[orgSlug]/projects/[id]
/app/[orgSlug]/projects/[id]/edit
/app/[orgSlug]/workspaces                # Optional Foundation workspace module
/app/[orgSlug]/search                    # Commercial cross-resource search
/app/[orgSlug]/settings/general
/app/[orgSlug]/settings/members
/app/[orgSlug]/settings/ownership
/app/[orgSlug]/settings/teams
/app/[orgSlug]/settings/roles
/app/[orgSlug]/settings/security
/app/[orgSlug]/settings/sso
/app/[orgSlug]/settings/billing
/app/[orgSlug]/settings/usage
/app/[orgSlug]/settings/audit-log
/app/[orgSlug]/settings/api-keys
/app/[orgSlug]/settings/webhooks
/app/[orgSlug]/settings/integrations
/app/[orgSlug]/settings/data
/operator                               # Separate operator authentication boundary
/operator/analytics                     # Product-wide reports, restricted to operators
```

Navigation responds to enabled modules and permissions. Deep links still perform all server checks. Billing managers do not automatically receive access to product content; support staff do not automatically receive customer access.

## 1.5 Reusability and additional suggestions

- Provide a product manifest for branding, enabled modules, navigation, plan definitions, React Email templates, and next-intl translations. Validate typed environment configuration with T3 Env and Zod; keep secrets in environment-specific secret stores.
- Build React 19 dashboard components with shadcn/ui and Tailwind CSS, forms with React Hook Form and Zod, and reusable state examples in Storybook.
- Ship reusable patterns for approval workflows, comments, tags, favorites, saved views, and custom fields as optional modules. Avoid forcing every entity to support them.
- Include a realistic two-organization demo with overlapping users and different permissions. Make it useful for onboarding, demonstrations, and security regression tests.
- Include a pricing simulator and an authorization inspector for developers/operators. Explain effective access without revealing inaccessible resource metadata to ordinary users.
- Provide developer documentation, architecture decisions, a module authoring guide, migration runbooks, and a release checklist.
- Track template provenance and supply codemods for upgrades. Applications should be able to update platform packages without replacing customized screens.
- Add tenant cost attribution and budget alerts for expensive workloads. If AI is added, meter actual provider costs, enforce budgets, and reuse the same tenant/access boundary for retrieval and tools.
- Start with fixed application schemas. Add tenant-defined custom fields through a typed metadata module only when needed; do not generate production DDL from tenant input.
- Keep regulatory certifications, full ERP/accounting, marketplace payouts, arbitrary workflow engines outside the default release. Each requires a separate product and operational design.

## 1.6 Success criteria

- A developer can bootstrap a renamed application with synthetic demo data using a documented local setup.
- An agent using the shipped skills turns an agreed feature brief into a working feature with database, API, permissions, navigation, and passing behavioral checks; ordinary source remains editable without regeneration.
- Magic links/passkeys pass replay, expiry, origin, recovery, and tenant-policy tests.
- Account deletion cannot orphan a continuing organization, cancel its subscription, or restore a deleted identity from backup.
- Product analytics demonstrates the defined funnels/adoption/retention reports, accurate tenant attribution, disabled tracking, provider outage behavior, and deletion cleanup.
- Cross-tenant access attempts fail through browser routes, APIs, direct repository calls, background jobs, files, search, and exports.
- Sharing, revocation, quota races, webhook replay, and subscription changes have deterministic automated coverage.
- Late projector writes, mismatched database restores, deletion after a backup, sole-owner deprovisioning, upload replacement after scanning, and seat races across entry points have explicit acceptance tests.
- Phase 0 demonstrates hot-tenant authorization availability and create-to-readable latency alongside revocation correctness; failed gates require an architecture decision before reusable skill workflows are released.
- An enterprise administrator can provision, govern, bill, audit, and offboard an organization without operator database edits.
- Every enabled module has ownership, configuration documentation, an upgrade strategy, and a measurable release gate.
