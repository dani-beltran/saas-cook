# Developer-configured product theme

## Intentional personal-mode extension (2026-09-27)

The [personal settings feature](personal-settings.md) supersedes the original exclusion of user-facing appearance controls and persisted modes. Product configuration remains the fallback and still exclusively owns palette, typography, radius, shadows and density. Only color mode now has a per-user database override, authenticated server resolution and immediate client synchronization. The original design and its verification below are retained as historical evidence; they do not verify the extension.

## Request and decisions

Unify the existing SaaS Cook appearance while preserving the current teal identity, localized authentication/dashboard flows, responsive layouts and developer-owned components. This is a presentation-only extension to the Foundation UI-01 shared theme/locale acceptance boundary in `docs/06-delivery-roadmap.md`.

- Product configuration lives in `apps/web/src/product-theme.ts`; visual values live only in `packages/ui/src/theme.css`. Zod validates a bounded set of choices and falls back per field. The app's environment and authorization boundaries remain unchanged.
- Teal is the default; Blue and Violet are additional presets. Color mode is independent, defaults to System and supports fixed Light/Dark. Native CSS color-scheme and light-dark resolve before hydration and follow OS changes without extra production client JavaScript.
- Both root layouts use the same document component and color-scheme metadata. The old local-storage hook and all user-facing appearance toggles are removed. Locale controls remain.
- Status colors are semantic and independent of brand. Controls use stronger input boundaries and explicit hover/foreground pairs, including destructive buttons in dark mode. Selected sidebar navigation gains a solid marker.
- Typography uses local/system fonts. Radius and shadow presets preserve hierarchy. Comfortable/Compact density is bounded; shared controls never drop below 36px. Global reduced-motion and forced-colors behavior also reaches portals.
- Storybook uses the production tokens/configuration, with development-only root controls and a localized component/portal showcase. No tenant branding, logo uploads, user preference persistence, email theming, new tables or services are introduced. Dependencies and lockfile pins remain unchanged.

## Verification

Verified on 2026-09-27 using Bun 1.4.2 and Node 24.19.0, with existing disposable local services. All final checks passed:

| Check | Result |
| --- | --- |
| `bun run check` | Passed |
| `bun run typecheck` | Passed |
| `bun run knip` | Passed; both Playwright configurations are explicitly discovered |
| `bun run test:unit` | 137 tests passed |
| `bun run build` | Production Next.js and packaged runtime build passed without application credentials |
| `bun run storybook:build` | Passed; upstream module-directive warnings remain non-blocking |
| `bun run test:theme` | 13 Chromium tests passed: 12 palette/mode/density combinations plus Spanish/System/reduced-motion/forced-colors/shape behavior |
| `bun run test:e2e` | 40 Chromium tests passed across 9 isolated real-service specs; no skipped, flaky or failed final tests |

Contrast assertions use actual computed/composited browser colors: 4.5:1 normal text (also used for showcase headings), 3:1 input boundaries and focus indicators, and selection/placeholder states. Actual authentication and authenticated dashboard surfaces have additional contrast checks. Native dialog Escape/focus restoration, body portals, no-JavaScript root appearance, held-script pre-hydration appearance, OS changes, fixed modes, ignored old storage and root hydration consistency passed.

Retained screenshots include 72 dashboard palette/mode/locale/viewport combinations, 24 authentication palette/mode/viewport combinations and 36 showcase desktop/mobile/portal views. Representative desktop/mobile Projects screenshots across all palettes and modes, the authentication views, and showcase/portal screenshots were visually inspected for hierarchy, wrapping, control clarity and overlay inheritance.

The initial enlarged visual test hit the existing session throttle; it now varies palettes on each loaded page without weakening security limits. Obsolete appearance-toggle expectations were updated. Visual QA found competing Button utility colors; typed action variants now select one pair. The inherited Input outline suppression was removed; browser assertions require a solid 2px focus outline as well as 3:1 contrast. Shared controls change color pairs immediately to avoid low-contrast transitions during an OS mode change. Initial failures and diagnostics remain under `artifacts/theme/diagnostics/` and `artifacts/theme/placeholder-diagnostic/`.

Final machine-readable evidence: `artifacts/theme/verification.json`. Command logs: `artifacts/theme/logs/`. Browser reports: `artifacts/theme/report/` and `artifacts/playwright/<spec>/`. No standalone integration, image, security scan or Phase 0 milestone is claimed; this change touches UI only, with real-service behavior exercised through the full browser suite.

## Changed source

- `packages/ui/src/theme.ts`, `theme.css`, `styles.css`: bounded configuration, semantic token definitions, Tailwind mapping and shared accessibility behavior.
- `apps/web/src/product-theme.ts`, `components/theme-document.tsx`, both root layouts: one developer entry point and document-root application.
- Owned Button/Input/form components, authentication/dashboard/feature CSS and locale catalogues: token adoption, density, semantic action/status pairs and removal of appearance controls. `components/appearance.ts` is deleted.
- Storybook preview and stories: production defaults, root toolbar controls and a localized theme/portal showcase.
- Unit/browser tests, `playwright.theme.config.ts`, `package.json` and `knip.config.ts`: validation, rendered contrast, browser coverage and discovered test entry points. Dependency pins and `bun.lock` are unchanged.
- `docs/development/theming.md` and `packages/ui/README.md`: developer customization and extension guide.

## Customization and limits

See [the theming guide](../docs/development/theming.md) for options, tokens and adding a palette without editing components. The implementation targets the modern CSS baseline of Tailwind v4, including color light-dark support. Browser acceptance currently runs Chromium; cross-engine and assistive-technology auditing is not implied. Computed contrast and screenshots cover representative states, not a blanket WCAG certification. Alternate preset browser tests use the validated document-attribute contract rather than building a separate product image for every combination.
