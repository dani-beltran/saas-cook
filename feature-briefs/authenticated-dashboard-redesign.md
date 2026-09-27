# Authenticated dashboard experience

## Scope and decisions

Redesign the existing Account, Organization and Projects routes as one localized, responsive experience. Preserve URLs, identity/tenancy/resource contracts, authorization, applied migrations and module availability. The existing authentication treatment and teal theme tokens remain the visual identity: system typography, quiet borders, restrained surfaces and clearly ranked actions.

The shared shell distinguishes personal settings from organization work. Organization selection navigates to an explicit route; it never establishes authorization. Membership choices come from the authorized organization list. Language changes preserve the route, query and anchor. Appearance is a local visual preference shared with authentication. Desktop navigation uses a sidebar; mobile uses a keyboard-operable disclosure and a skip link.

Account groups identity, organizations, security and sessions. Organization administration uses contextual sections for members, invitations, teams, security and ownership. Ordinary members see only the existing authorized summary. Projects use the server's search and cursor continuation, without totals, with focused editing and secondary workspace management. Destructive/security actions explain consequences before execution.

All server-owned authorization, seat/capacity checks, expected versions and mutation contracts remain intact. Client operations prevent duplicate submissions and retain operation keys for a retry of the same payload. Loads reject superseded responses. Errors remain local to their action and recoverable forms retain input. No billing, global search, activity, profile editing, account deletion or API-key management is introduced.

## Acceptance and evidence

Relevant existing acceptance IDs: R-TENANCY, R-AUTHZ, R-SEATS, R-OWNER, R-TRANSFER, R-PASSKEY, R-PASSWORD, R-WORKSPACES, R-POLICY. This UI change does not claim a new platform milestone. Run source/type/unused checks, unit tests, Storybook and production builds, plus browser journeys through isolated disposable PostgreSQL/control/OpenFGA/mail services. Retain browser failure diagnostics and screenshots under ignored artifacts. Visually review Account, Organization and Projects at desktop/mobile widths, English/Spanish, light/dark. Record actual results and limitations at completion.

## Implementation

- `apps/web/src/components/dashboard-shell.tsx`, `dashboard.css` and `appearance.ts` provide the shared navigation, organization context, runtime branding and appearance preference. The locale layout supplies the configured brand; authentication shares the appearance preference.
- `account.tsx`, `organization.tsx` and `projects.tsx` retain their existing route families and supported services, with corresponding page styles. Organization navigation uses addressable sections. Account security retains pending MFA, passkey, authenticator, recovery and session workflows. Project editing, deletion/restoration and workspace management retain the service's versions and cursor behavior.
- Localized copy lives in `apps/web/src/i18n/*dashboard.ts` and the existing shared Projects messages. `packages/ui/src/project-form.tsx` preserves drafts, validates unavailable workspace selections and uses shared form primitives.
- Dashboard/organization and project-form stories exercise loading, retry, themes, validation, member/team controls and a workspace disappearing during a draft. Browser tests cover real-service actions, denial, confirmation, stale responses, committed-response-loss retries and the visual matrix.
- The default browser command now gives each spec a fresh disposable installation so the shared-source authentication throttle does not couple unrelated test users. Production limits remain enabled. Explicit Playwright arguments retain native CLI behavior; per-spec reports remain under `artifacts/playwright*`.

## Verified on 2026-09-27

Base commit: `9faf8f6df35c099a196432cca81807d7083dfa4f`. Bun 1.4.2 and Node.js 24.19.0. Synthetic accounts and disposable PostgreSQL, control-store, OpenFGA and Mailpit services only. No schema, applied migration, API contract or authorization-service changes.

| Check | Result |
| --- | --- |
| `bun run check`, `bun run typecheck`, `bun run knip` | Passed |
| `bun run skills:check --static` | Four checks passed |
| `bun run test:unit` | 105 tests passed |
| `bun run test:integration packages/api/src/resources.integration.test.ts` | Eight real-service tests passed |
| `bun run build` | Passed |
| `bun run storybook:build` | Passed |
| Built Storybook in Chromium | All 21 dashboard/project stories completed, including their play functions, with no browser errors |
| `bun run test:e2e` | 29 tests passed; zero skipped, unexpected or flaky results |
| Visual inspection | All 24 page/locale/theme/viewport combinations reviewed; desktop 1440×1000 and mobile 390×844 |

Browser evidence includes MFA/recovery/passkeys, session revocation, invitation and both ownership-transfer outcomes, last-owner and cross-tenant denial, ordinary-member field access, reauthentication requirements, project conflicts, workspace lifecycle, stable retry keys after interleaved actions, and preservation of a draft whose selected workspace is archived. Keyboard navigation, validation focus, mobile disclosure/Escape and localized invitation acceptance are exercised.

Logs are retained in `artifacts/dashboard-*.log`; grouped browser JSON/HTML, traces and denial screenshots are in `artifacts/playwright-results/` and `artifacts/playwright/`. The 24 visual captures and Storybook browser results are in `artifacts/dashboard-redesign/`. Failed attempts remain there with their diagnostics; recovered failures included obsolete test selectors/confirmations, cross-spec throttling and a formatting issue.

Verification limits: Chromium only; no physical-device or assistive-technology audit. The full integration suite, image acceptance, vulnerability scans and authorization benchmark were not run for this view-only change. This is feature verification, not a Phase 4 live-agent evaluation or a new platform acceptance claim.
