# Module availability for agent-authored features

Use this implementation inventory with the [roadmap acceptance register](../06-delivery-roadmap.md#capability-to-phase-and-acceptance-matrix). A package dependency, a brief or a future-phase design is not an implemented module. Do not turn an absent module into a passing check or replace a required boundary with a permissive stub.

| Capability | Foundation implementation and extension boundary |
| --- | --- |
| Identity, sessions, password/magic-link/passkey/MFA | `packages/auth`; preserve current assurance and lifecycle enforcement. Application tenancy owns memberships/ownership; do not route lifecycle changes through an identity plugin bypass. |
| Organizations, teams, seats, ownership | `packages/db/src/tenancy.ts`, `packages/authz`; local seat admission is implemented. Directory synchronization, account deletion and full restore/deletion journals remain later phases. |
| Project and optional workspaces | `packages/db/src/resources.ts`, current API/UI. `WORKSPACES_ENABLED` gates new workspace operations/assignments. Existing parents retain documented inheritance; removal is not an implicit reparent. |
| Local entitlement/capacity | Project policy plus generic reservations in `packages/db/src/resources.ts`; real transactions distinguish missing, disabled, zero, limited and unlimited. `DEFAULT_PROJECT_CAPACITY` is an initialization default, not an update to existing tenant policy. Provider-independent admission is not a billing ledger. |
| Service accounts/API keys | `packages/authz/src/keys.ts`, current key/account checks and explicit per-endpoint support. Project/workspace scope vocabulary is implemented. New endpoint/resource support is opt-in, including inherited child mappings. Customer key-management UI remains later work. |
| API | Shared oRPC and strict Zod DTOs; RPC/REST use the same services. `packages/api/src/resource-boundary.ts` declares whether each endpoint permits service accounts. A bearer header never falls back to a cookie. |
| Transactional identity/security email | React Email, encrypted short-lived delivery records and bounded worker retries. See [email workflow](email-workflow.md). Domain notifications, preferences and in-app notification feeds are not implemented by the identity renderer. |
| Audit/outbox | Domain events commit atomically and contain bounded allowlisted metadata. A durable event is not automatically a notification, activity feed, usage charge or analytics event. |
| Local worker/services | Disposable PostgreSQL application/control stores, OpenFGA, mail and queue runtime support Foundation validation. Test installation helpers create isolated databases; never bootstrap an ambient database as a fixture. |
| Billing/providers/usage ledger | Phase 5. A pinned Stripe dependency is not an adapter. Foundation tests need no billing credentials and must retain real local policy enforcement. |
| Files/import/export, cross-resource search, activity feeds, analytics | Phase 6. Do not expose unrestricted storage/search/counts as a substitute. Project-local search is available; it does not satisfy cross-resource search. |
| Enterprise identity/custom roles/support | Later phases. Existing FGA model types and roles are bounded; complex graphs need an explicit design and tests. |

For a feature requiring an unavailable capability, either implement the prerequisite as authorized work with its own contracts/tests or report the feature incomplete. Disabled modules remain disabled in the product brief and runtime. Do not set a flag merely because a route/template was added. Commercial and Enterprise presets cannot be declared accepted from Foundation checks.

Environment changes belong in `packages/config/src/server.ts` / `client.ts`, `.env.example` and affected runtime composition. Preserve the public allowlist, startup validation, role separation and credential-free builds. Do not use `NEXT_PUBLIC_*` for environment-specific image settings. Logs use shared LogTape/correlation boundaries. Loading a skill confers no authority to publish, provision live systems, send external notifications or change billing.
