# Phase 0 identity decision and evidence

Status: **Foundation adapter feasibility demonstrated, with required application controls.** The identity choice remains Better Auth; organization membership, owner recovery, transfer and global account deletion remain application-owned. These spikes do not constitute Phase 2 acceptance or enable enterprise SSO/SCIM in an application.

Validated on 2026-09-22 with Node.js 24.19.0, Better Auth / passkey / SCIM 1.7.5, Drizzle 0.45.3, node-postgres 8.23.0 and PostgreSQL 18.6. Installed package metadata declares `MIT` for `better-auth`, `@better-auth/passkey`, `@better-auth/scim` and `@better-auth/sso` 1.7.5. Version changes require rerunning these probes. No paid identity account was used.

## Reproduce

Start the disposable services using the repository's Phase 0 instructions. The default test database is `postgresql://postgres:phase0@127.0.0.1:55432/phase0`; override it with `PHASE0_DATABASE_URL`. The tests create and truncate only their `identity_spike` and `identity_scim_spike` fixture schemas. Use a disposable database, never application data.

```sh
bun run phase0:test spikes/phase0/identity/assurance.test.ts spikes/phase0/identity/lifecycle.test.ts
PHASE0_INTEGRATION=1 bun run phase0:test spikes/phase0/identity/provider.test.ts spikes/phase0/identity/scim.test.ts
bun run phase0:typecheck
```

The model run passed **41 deterministic cases**, including nonfinite authentication timestamps added during review. The provider run passed **20 real provider/database cases** in 2.20 seconds. Type checking passed. Without `PHASE0_INTEGRATION=1`, the provider suites are explicitly skipped; that is not integration evidence. Do not run them during the authorization benchmark's measured interval.

## What was actually proved

| Evidence | Executed boundary | Result and limit |
| --- | --- | --- |
| Magic token storage, expiry and generic request response | Better Auth magic-link plugin → Drizzle adapter → PostgreSQL | Token absent from stored verification values; known/unknown requests return the same response; unknown-account redemption does not create a user; expired/replayed tokens fail. Timing indistinguishability and delivery-side enumeration were not measured. |
| Atomic magic-link redemption | Four independent Node processes, separate adapters/pools, one shared PostgreSQL challenge | Exactly one session created. Separate processes prevent the provider's process-local consume mutex from concealing a database race. |
| Scanner confirmation | Small HTTP `Request`/`Response` facade in `provider.ts` | GET renders a non-consuming confirmation response; only same-origin JSON POST calls the internal verification API. Raw verification is disabled in Better Auth's public handler as well as the facade. Unsafe redirects and cross-origin POSTs fail before consumption. No browser UI or scanner service was tested. |
| Account freeze | Provider session-create hook | A frozen fixture identity cannot obtain a new magic-link session. The authoritative persistent lifecycle fence and existing-session request checks remain application work. |
| Passkey ceremonies | Real Better Auth/SimpleWebAuthn verification of P-256 fixtures against PostgreSQL | Authenticated registration, two named credentials, sign-in, counter update, challenge expiry/replay, origin, RP ID, challenge, signature and server-verified UV checks pass. Fixture private keys exist only in the test authenticator; application storage contains public credentials. |
| Credential removal | Provider internal delete API and blocked public route | Revocation prevents later sign-in. Direct public deletion requires a domain command; the separate policy model covers freshness and recovery before removing the last credential. |
| SCIM mapping | Real SCIM HTTP endpoints → Better Auth native PostgreSQL/Kysely adapter → transaction-bound projection probe | Stable `(connection, external subject)` mapping, cross-connection read denial, no email-only linking, preserved global user/profile, scoped deactivation, delete/recreate identity continuity and rollback on callback failure pass. This extra probe uses Kysely solely to exercise the plugin's generated schema; production SQL access remains Drizzle. |
| Assurance | Pure application decision model | Email possession is insufficient for MFA; a passkey needs verified UV and explicit tenant policy acceptance; target-tenant SSO is rechecked; stale/future evidence and frozen/deleted accounts fail. No user-supplied assurance claim is an acceptable input. |
| Ownership, seats and account closure | Deterministic asynchronous lifecycle model | Concurrent last-owner demotions preserve one owner; security removal works with FGA unavailable; repeated release is idempotent; invitation/SCIM/reactivation compete for the final seat; transfer and freeze races preserve continuity; recovery stays gated until the admitted revision is published. |

The lifecycle model deliberately uses exclusive in-process mutexes, not PostgreSQL shared/exclusive fences. Its traces enforce sorted user fences before sorted organization authorization/lifecycle/capacity/membership locks. It verifies the decision rules and interleavings; it does **not** prove database deadlock freedom, cross-process lifecycle isolation, actual FGA publication, audited operator identity, provider outage handling or restore safety. Recovery publication is an injected callback. Real production services and integration suites remain required under `R-LIFECYCLE`, `R-OWNER`, `R-TRANSFER` and `R-ACCOUNT`.

## Required adapter decisions

### Email links

Use `magicLink({ storeToken: "hashed", disableSignUp: true, expiresIn: 300 })`. Admission precedes identity creation; product registration/invitation policy must explicitly enable any alternative. Deliver a confirmation URL on the canonical auth origin and disable the public `/magic-link/verify` path. Invoke its server API only after an intentional confirmation POST, strict origin/content-type checks and destination validation. Apply `no-store`, `no-referrer`, token redaction and protected short-lived email delivery. The facade is a contract probe, not the finished confirmation screen.

The provider's defaults are materially different: plaintext token identifiers, automatic signup and GET redemption. Its current atomic consume path supports the observed multi-process behavior. The documented secondary-store alternative requires atomic `getAndDelete`; this decision uses PostgreSQL instead. [Better Auth magic-link documentation](https://better-auth.com/docs/plugins/magic-link)

Ingress limits per source and identity, CSRF/browser journeys, wrong-account invitation acceptance, actual email delivery/retry and redaction verification are Phase 2 work. Rate limiting is intentionally disabled in the provider fixture so the race tests measure redemption, not throttling. Do not copy that fixture setting into production.

### Passkeys and assurance

Fix origin and RP ID explicitly for each deployment. This fixture uses `https://auth.example.test` / `auth.example.test`; it is not a product hostname decision. Tenant custom domains must redirect to the canonical authentication origin. Authenticated registration, named credentials and removal are supported by the plugin. [Better Auth passkey documentation](https://better-auth.com/docs/plugins/passkey)

**Observed 1.7.5 gap:** the installed passkey implementation invokes registration and authentication verification with `requireUserVerification: false`. Registration's `authenticatorSelection.userVerification: "required"` is not enough to enforce verified UV on the server; generated authentication options use `"preferred"`. A regression test produces a correctly signed assertion with no UV bit and demonstrates it succeeds when the application hook is absent. Both supported `afterVerification` hooks in the spike reject unless the library's verified `userVerified` result is true. Browser/device UI preferences are never assurance evidence.

The installed enrollment endpoint uses fresh-session middleware, but passkey removal uses ordinary session middleware and resource ownership. Keep direct removal disabled until the domain command enforces fresh authentication, account status, audit and a tested recovery path. Keep `user.deleteUser.enabled: false` and disable both direct deletion endpoints; personal deletion must use the global lifecycle orchestrator.

Persist verified method, authentication time, UV/MFA result, SSO connection, credential/recovery epoch and policy context in protected session assurance records in Phase 2. The fixture tests server verification plus the policy function separately; it does not yet implement durable assurance propagation. Passwordless reauthentication must invoke a fresh permitted ceremony without asking for a nonexistent password. Playwright/virtual-authenticator and real-device coverage, enrollment/removal races, recovery, session persistence and tenant policy enforcement on every entry point remain due.

### Enterprise mapping and licensing

The current self-hosted SSO plugin documents OIDC/OAuth2/SAML, organization provisioning options and a stable verified account subject. Disable automatic organization provisioning and implicit signup; route successful identity resolution into the application admission boundary. Keep email-based automatic account linking disabled. Self-service SSO onboarding is separately advertised through Better Auth Infrastructure/enterprise contact; no dashboard entitlement, price, SLA or vendor contract is assumed from the npm package's MIT license. A selected IdP, customer onboarding flow and commercial terms remain product/operator decisions. [Better Auth SSO documentation](https://better-auth.com/docs/plugins/sso)

SCIM exposes connection/provisioning-domain mappings and transaction-bound identity reconciliation. The probe explicitly links a known immutable external subject, preserves the user's global profile and computes access separately per provisioning domain. A deactivated source denies that organization while another source stays active. The aggregate `state.active` is insufficient for tenant decisions. The plugin revokes global sessions when its final SCIM source becomes inactive; it preserves the global user and does not itself forbid later authentication. Treat that as reauthentication, never as authority to globally delete/disable a user or restore revoked membership. The actual probe also verifies rollback when the callback fails. [Better Auth SCIM documentation](https://better-auth.com/docs/plugins/scim)

Do not mount enterprise directory endpoints in Foundation. Before Enterprise, integrate callbacks with the canonical lifecycle lock order and shared seat/owner boundary; the probe's `directoryAccess` table is only evidence that transaction-scoped projection is possible. The plugin acquires its own identity/projection fences, so composing those with application user/organization locks needs a real SQL race/deadlock suite, not a callback that opens a second independent transaction. Map connection credentials to bounded control-plane authority. SSO/SCIM replay, real IdP operation, role/group mapping and deprovisioning through the complete application have not been run.

## Ownership and global lifecycle contract

The fixture follows [the canonical lock order](../03-data-model.md#canonical-lifecycle-lock-order): users sorted by ID first, then organizations sorted by ID, then authorization fence → lifecycle/owner row → capacity → memberships. Account freeze acquires the user fence before enumerating memberships, preventing an admission from appearing after the obligation check. Acceptance locks both parties, checks current account/member state, verified recipient, caller, expiry and ownership version, then commits the role change and audit/outbox with the seat delta.

Voluntary demotion cannot remove the final active owner. A narrowly authorized security command revokes immediately, releases a seat exactly once and enters owner recovery even if FGA is down. No graph allow result is required for that security revocation. Recovery requires independently verified authority, fresh MFA, evidence, capacity admission and successful publication for the current revision; an old completion cannot reopen a tenant after replacement deprovisioning.

Account freeze examines every ownership obligation and cancels pending incoming/outgoing transfers under the user fence. It blocks admissions and ownership acceptance immediately. Seat cleanup is separate and idempotent. It does not delete continuing tenant resources, billing accounts or service accounts. The model contains neither a deletion journal nor provider purge: independent acknowledgement, resumable cleanup, credential revocation, analytics suppression and restore/revalidation remain the Phase 6 implementation described in [operations §4.8](../04-billing-usage-operations.md#personal-account-deletion-and-ownership-continuity-commercial-core).

The model assumes verified authority/freshness have already passed the separate assurance boundary; its public methods are not an authorization API. Fresh MFA evidence booleans in test fixtures are not acceptable external inputs. A PostgreSQL-backed production implementation must establish them from independent evidence and persist audit receipts atomically.

## Gate assessment

- `AUTH-01`: concrete provider mapping and domain decision probes exist. The chosen stack can support the proposed boundary, with the limitations above.
- `R-MAGIC` / `R-PASSKEY`: Phase 0 adapter behaviors are measured; Phase 2 application/browser/email/recovery acceptance is not passed by these tests.
- `R-LIFECYCLE` / `R-OWNER` / `R-TRANSFER`: deterministic contract evidence exists; production SQL concurrency, real authorization publication and operator evidence remain unimplemented.
- `R-ACCOUNT` / `R-RECOVERY`: freeze/continuity model only; no deletion completion or restoration claim.
- Enterprise: package licensing and mapping APIs verified; self-service commercial terms, supported IdPs and the complete directory/domain transaction integration remain unresolved.

Source observations were made against the installed pinned distributions: `better-auth/dist/plugins/magic-link/index.mjs`, `better-auth/dist/db/internal-adapter.mjs`, `@better-auth/passkey/dist/index.mjs`, `@better-auth/scim/dist/index.mjs` and package metadata. The lockfile identifies those artifacts. Prefer these exact-version results over assuming the rolling documentation applies unchanged to future versions.
