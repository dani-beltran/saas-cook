# Product appearance

Edit `apps/web/src/product-theme.ts`, then rebuild. This developer-owned, public source configuration is independent of runtime environment validation in `packages/config`. It contains no secrets or tenant IDs. Its color mode is the fallback for users without a saved personal preference; other options remain developer-owned. Both Next.js root layouts use `ThemeDocument`; Storybook starts from the same configuration.

```ts
export const productTheme = resolveThemeConfig({
  palette: "teal",
  mode: "system",
  typography: "system",
  radius: "rounded",
  shadows: "subtle",
  density: "comfortable",
} satisfies ThemeConfig);
```

| Option | Supported values | Default |
| --- | --- | --- |
| Palette | `teal` (existing identity), `blue`, `violet` | `teal` |
| Mode | `light`, `dark`, `system` | `system` |
| Typography | `system` (native sans), `humanist` (local Trebuchet/Verdana), `serif` (Georgia headings with native sans body) | `system` |
| Radius | `square`, `rounded`, `soft` | `rounded` |
| Shadows | `none`, `subtle` | `subtle` |
| Density | `comfortable`, `compact` | `comfortable` |

`ThemeConfig` catches invalid choices during authoring. `resolveThemeConfig` validates at runtime too: each invalid or omitted field uses its safe default; a malformed top-level value uses all defaults. Unknown fields are discarded. Only bounded option names become HTML attributes. Configuration accepts no CSS, URLs, HTML, font downloads or arbitrary sizes. Editing the product defaults needs no new services or `NEXT_PUBLIC_*` settings. Personal color-mode persistence uses the existing identity database and reviewed migration 0009. Application name remains in the existing public configuration boundary.

## Token contract

`packages/ui/src/theme.css` is the only source of visual values. `theme.ts` defines option names and validation, not a second palette. `styles.css` exposes semantic tokens through Tailwind v4 `@theme inline` and supplies shared base/accessibility rules. Import `@common-saas/ui/styles.css` once per root. The owned Button supports typed `primary`, `secondary` and `destructive` variants; use these instead of competing background utilities. Components use literal utilities (`bg-primary text-primary-foreground`) or CSS variables, never computed Tailwind class names.

Account mode previews resolve the shared `background`, `muted`, `primary` and `border` light/dark pairs within each preview. This preserves their independent color schemes when the CSS compiler resolves inherited semantic tokens at the root. Light and Dark stay fixed; System follows the device even when the page uses a fixed mode.

| Family | Tokens and intended use |
| --- | --- |
| Page and surfaces | `background`/`foreground`, `card`/`card-foreground`, `popover`/`popover-foreground` |
| Brand actions | `primary`/`primary-foreground`, `primary-hover` (same foreground), `accent`/`accent-foreground` |
| Secondary actions | `secondary`/`secondary-foreground`, `secondary-hover` (same foreground) |
| Supporting content | `muted`/`muted-foreground`; muted text is also tested on page/card surfaces |
| Boundaries | `border` is a decorative separator; `input` identifies control boundaries at 3:1 or better, `input-background` is the control surface, `ring` is the focus outline |
| Navigation | `sidebar`/`sidebar-foreground`, `sidebar-accent`/`sidebar-accent-foreground`, `sidebar-border`, `sidebar-ring`; selected navigation also has a solid brand marker |
| Error/destructive | `destructive`/`destructive-foreground` for solid buttons, `destructive-hover`; `destructive` text on `danger-surface` for notices |
| Other statuses | `success`, `warning`, `info` are text/icon/border colors; use each `*-surface` with its `*-foreground` for notices and badges |
| Overlays | `overlay` for native dialog backdrops; `popover` tokens for foreground content |
| Typography | `font-body`, `font-heading`, `font-code`; allowlisted local/system stacks only |
| Shape | `shape-radius`, derived `control-radius`, `panel-radius`, `dialog-radius`, `auth-radius`; circle avatars remain circles |
| Elevation | `elevation-low`, `elevation-panel`, `elevation-overlay`; all turn off together |
| Density | `control-height`, `auth-control-height`, `control-padding-y`, `field-gap`, `row-padding-y`; page widths, breakpoints and heading hierarchy remain component-owned |

Comfortable shared controls are 40px high; Compact controls are 36px. Authentication controls are 46px/40px. Density reduces control/form/row spacing without scaling fonts or entire pages. Small independent controls retain the 24px minimum target or an enclosing label target. Do not use a decorative `border` token where a boundary is needed to identify a control. Disabled controls remain distinguishable but are exempt from WCAG text contrast requirements.

Status colors do not follow the brand palette. A violet brand still uses green success and red error, with visible text labels rather than color alone. Preserve paired foregrounds: white text on a pale dark-mode destructive button is not valid.

## Rendering, System mode and security

The server writes validated `data-*` attributes on `<html>` and Next.js emits the matching color-scheme viewport metadata. The root stylesheet sets `color-scheme` and paired `light-dark()` colors. System mode follows OS changes directly through CSS; fixed modes use `only light`/`only dark`. The same inherited values reach body portals, top-layer dialogs, scrollbars and native controls.

Personal settings → Account identity → Appearance exposes Light, Dark and System. Both roots use a shared, request-cached, verified identity snapshot for HTML attributes and viewport metadata before paint. `identity.user.theme_mode = NULL` preserves the product fallback. Identity unavailability also uses the fallback so sign-in and recovery pages remain available. The client provider updates only `data-mode` and color-scheme metadata, with immediate selection, revisioned saves and authoritative failure reconciliation. No hydration suppression or pre-paint inline script is needed.

Browser state is scoped to the current user and session. No local-storage value or preference cookie selects initial appearance. Old `common-saas-appearance` values remain ignored. Cross-tab messages only invalidate caches; focus, visibility and a visible-tab 30-second refresh fetch the verified user's settings. Mutations assert the expected account and reject a cookie/account switch. Theme preferences never authorize identity, organization or resource access. See the [personal settings brief](../../feature-briefs/personal-settings.md) for concurrency, deployment and verification.

This uses the modern browser baseline of the existing Tailwind v4 application. CSS color `light-dark()` is [Baseline 2024](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/light-dark); [color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme) selects the paired colors and native-control appearance. Legacy browsers without those CSS capabilities are not supported by this implementation. Changing this support policy requires a separately verified CSS fallback, not a late JavaScript repaint.

Shared controls switch color pairs immediately, avoiding a low-contrast intermediate frame when the OS mode changes. Global reduced-motion rules disable animations and transitions, including portals. Forced-colors mode keeps native color adjustment enabled and adds system-colored focus and control borders. Test native interactions as well as color ratios; passing a contrast calculation is not a complete accessibility audit.

## Add a brand preset

1. Add the bounded preset name to `themeOptions.palette` in `packages/ui/src/theme.ts`.
2. Add a `:root[data-palette="your-preset"]` block in `theme.css`. Supply `primary-light` and `primary-dark` (which feed both `primary` and the mode previews), plus paired values for `primary-foreground`, `primary-hover`, `accent` and `accent-foreground`. The common neutral surfaces, ring and sidebar aliases inherit automatically. Keep status meanings unchanged. If overriding neutrals, update every affected pair and its contrast coverage.
3. Select the preset in `product-theme.ts`. No component edit, runtime registry or schema change is required. The Storybook toolbar and palette browser matrix read `themeOptions` automatically.
4. Run the checks below. Verify normal and hover button foregrounds, links, selected navigation, input borders, focus outlines, validation and overlays in both modes. Require 4.5:1 normal text, 3:1 large text and applicable non-text contrast. The supplied theme matrix uses the stricter 4.5:1 even for showcase headings.

For deeper design changes, edit the CSS tokens in source; do not expose unrestricted custom-property overrides to browsers or tenants. Tenant branding, uploaded logos, arbitrary user theme configuration and email theming remain outside this feature; only color mode is personal.

## Development and verification

`bun run storybook` exposes palette, mode, density, locale, typography, radius and shadow controls. `Foundation/Theme` includes the owned Button/Input, localized SampleForm, navigation, status notices, validation and a native dialog rendered through a React body portal. Existing feature stories also inherit the root theme. Storybook alone uses a layout effect to apply its development controls to the preview document and restores prior attributes when unmounted.

Run from the root:

```sh
bun run check
bun run typecheck
bun run knip
bun run test:unit
bun run storybook:build
bun run test:theme
bun run build
bun run test:e2e
```

The theme suite starts local Storybook on port 6106. It measures computed/composited browser colors, covers every palette × light/dark × density combination, and retains desktop/mobile/portal screenshots and reports under `artifacts/theme/`. Production browser tests use the documented disposable PostgreSQL/OpenFGA setup; the wrapper gives each spec a fresh isolated installation. Theme-specific production tests cover both root layouts with JavaScript disabled and with framework scripts held until SSR appearance is checked, OS changes, ignored old preferences and hydration errors. Alternate preset/mode tests apply the exact validated root-attribute contract in the browser; they do not claim separate production builds for every preset. The production build uses the checked-in defaults.

Authenticated screenshots include all palettes, both modes, both locales and desktop/mobile at `artifacts/dashboard-redesign/screenshots/`. These and authentication screenshots supplement the component contrast assertions. They are visual evidence, not screenshot-diff baselines or proof of authorization. Existing real-service journeys remain required. See the [feature brief](../../feature-briefs/product-theme-system.md) for recorded results and limitations.
