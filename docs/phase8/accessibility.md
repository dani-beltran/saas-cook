# Phase 8 Commercial accessibility

P8-06 adds a repeatable accessibility gate and fixes three reproduced customer-interface defects. It does not accept the optional Backoffice release or claim complete WCAG conformance from automated scans. The release candidate still needs its final-source CI and accessibility review in P8-08.

## Implemented fixes

- Search rejects whitespace-only input through the shared schema and now associates a localized, announced validation error with the focused field. Native validation is disabled on this form so English and Spanish use the same explicit validation path.
- Search activity opens a named region, moves keyboard focus into it, and returns focus to its initiating result when closed.
- The Help CSV example is now a named scroll region with a visible focus ring. Keyboard users can scroll the complete example on narrow screens. The initial automated scan reproduced `scrollable-region-focusable` in both mobile contexts; a regression now presses ArrowRight and verifies scrolling.

No shared primitive or Backoffice implementation changed. The shared test dependency is exactly `@axe-core/playwright` 4.14.0 with `axe-core` 4.14.0 in `bun.lock`. The sole Knip entry addition covers the helper imported by both browser suites. P8-02 owns CI wiring of the existing `test:theme` command; customer browser discovery already includes the new spec.

## Executable coverage

[The shared audit](../../tests/accessibility.ts) runs axe's WCAG 2 A/AA, 2.1 A/AA and 2.2 AA tagged rules, including contrast, without rule exclusions. Each scanned state retains the complete result, including incomplete/manual-review candidates, as a Playwright JSON attachment. Assertions fail on every reported violation, independent of severity.

[The story matrix](../../tests/theme/accessibility.spec.ts) audits 30 explicitly inventoried states in four contexts: English/light/1440px, English/dark/390px, Spanish/dark/1440px and Spanish/light/390px. This is a representative matrix, not all eight locale/theme/width combinations. All stories use actual production components. Story tests do not establish service authorization or provider behavior.

| Journey | Scanned UI and state coverage | Behavioral coverage retained |
| --- | --- | --- |
| Identity and account | Sign-in page; account identity, organizations, security, sessions and privacy panels; appearance ready/loading | `auth-experience.spec.ts`, `identity.spec.ts`, `account-dashboard.spec.ts`, `personal-settings.spec.ts`: validation, focus, freshness and account actions |
| Navigation and tenancy | Full customer shell, navigation loading/unavailable, organization member and team controls | `organization-dashboard.spec.ts`, `dashboard-visual.spec.ts`: responsive navigation and team/member confirmation |
| Projects and private files | Real project list and edit/file panel; create/invalid/saving/pending-edit stories; real deletion dialog | New browser assertions cover initial dialog focus, Escape and focus restoration; `projects-dashboard.spec.ts`, `files.spec.ts` retain mutation/denial/upload behavior |
| Customers | Directory, create validation, pending and recoverable-failure stories; real customer route | `example-customers.spec.ts`: stale-version conflict, denied drafts, retry preservation, dialog and keyboard actions |
| Billing and usage | Real Foundation billing/usage; enabled pending command, quota reached, over-capacity and provider-outage presentation; real cross-tenant denied screen | `billing.spec.ts`: real consumption and denied access; provider behavior remains Phase 5 evidence |
| Search and activity | Real populated search, invalid query, focused activity, and loading/empty/denied/recent activity stories | `platform.spec.ts` plus new linked-error and focus-restoration regressions |
| API keys, data jobs and organization settings | Real ready/empty route scans, including labelled controls and responsive layout | `platform.spec.ts`, `data-jobs.spec.ts`: current-session issue/rotate/revoke, import/export, audit and settings |
| Privacy and notifications | Real account privacy panel and organization privacy route | `privacy.spec.ts`, `data-jobs.spec.ts`: unavailable preferences, saved-status announcements, identity/ownership blocks, deletion-review focus and cancellation |
| Help and public information | Both public pages in all four contexts; mobile CSV keyboard scrolling | `public-pages.spec.ts`: localized content and receipt handling |
| Shared controls and Backoffice regression | Shared controls ready/disabled/validation; Backoffice empty/pending/denied/organization stories | Existing theme controls check focus trap, busy-dialog dismissal, Escape and opener restoration |

[The real-session browser matrix](../../tests/e2e/accessibility.spec.ts) creates synthetic sessions, organizations and a project using the existing restricted-role fixture. It audits each selected route after hydration, checks horizontal overflow, and never replaces the server's authentication or authorization with a browser mock. Isolated installation setup and cleanup remain owned by the existing browser harness.

Existing [theme checks](../../tests/theme/showcase.spec.ts) additionally measure rendered foreground/background, placeholder, selection, focus and border contrast across all declared palettes/densities, test reduced motion and forced colors, and check body-portalled dialogs. The [controls checks](../../tests/theme/controls.spec.ts) verify native form data, labels, radio/checkbox keyboard interaction and busy-dialog behavior.

## Local verification and evidence

Environment: macOS, Bun 1.4.2, Node 24.19.0, Playwright 1.63.0 Chromium. Source base: `6cc51566f698e48225ec1bab11a1e3b8f416ac66` plus this PR's source delta. Runs performed on 2026-10-22 against disposable local PostgreSQL/OpenFGA/S3 services where applicable. Source hashes and report hashes are retained under `artifacts/phase8/accessibility/manifest.json`; raw artifacts remain ignored.

- `bun install --frozen-lockfile`: passed with no dependency changes after the exact pin.
- `bun run check`, `bun run typecheck`, `bun run knip`: passed. Source check reported four pre-existing informational Backoffice style suggestions and exited successfully.
- `bun run test:unit apps/web/src/i18n`: 4 catalog tests passed.
- `bun run build`: passed, including standalone/runtime packaging.
- `bun run test:theme --workers=4`: 137 passed, 0 skipped, 0 flaky; about 48 seconds locally. This includes all 120 new state scans and 17 keyboard/contrast tests.
- `bun run storybook:build`: passed; bundler emitted the existing module-level `use client` warnings.
- `bun run test:e2e tests/e2e/accessibility.spec.ts tests/e2e/platform.spec.ts tests/e2e/public-pages.spec.ts --workers=2`: 9 passed after the Help fix. The final expanded `bun run test:e2e tests/e2e/accessibility.spec.ts --workers=2` run passed all 4 contexts in about 30 seconds, including account tabs, private files and deletion-dialog keyboard behavior. An intermediate run was interrupted after a test omitted opening the project actions disclosure; its diagnostics are retained in `interrupted-dialog-test/` and the corrected final run passed.

Initial failing mobile reports and traces are preserved in `artifacts/phase8/accessibility/initial-browser-failure/`; successful theme results in `artifacts/phase8/accessibility/story-matrix/`. Current browser report and traces are under `artifacts/playwright/` and `artifacts/playwright-results/` and copied into the evidence directory after completion.

## Acceptance limits

Automated scans and DOM focus assertions cannot certify spoken output, reading order as experienced with a screen reader, cognitive usability or every device/browser. This run did not use a human screen reader. Review incomplete axe findings and perform assistive-technology review on the chosen release candidate before declaring full accessibility acceptance. Provider-hosted checkout/portal surfaces belong to their provider. Enterprise and future Backoffice journeys are outside this customer scope. Full application/hosted CI and final-candidate applicability remain P8-08 responsibilities; the local targeted runs do not claim those jobs passed.
