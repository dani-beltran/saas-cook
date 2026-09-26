# Shared UI patterns

Components are checked-in source, consumed by Next.js and Storybook. The form uses native labels, described validation errors, focus-on-error and a status announcement. It validates a browser-only draft; a feature must independently validate and authorize its server mutation.

`src/input.tsx` is adapted from the official shadcn/ui `new-york-v4/input` registry source retrieved on 2026-09-26. The exact response is retained in `vendor/shadcn-input.json` (SHA-256 `b1fffa12ba72ce30a291749012b47235eda110648b8106725ced22b5b31c8f1b`), with the upstream MIT license. Changes: use a type-only React import and a local string-only class combiner; Biome formatting. Source: <https://ui.shadcn.com/r/styles/new-york-v4/input.json>. The button, sample form, theme and messages are repository-owned patterns; no registry download runs during builds.

Use `bun run storybook` or `bun run storybook:build` from the repository root. Stories cover English/Spanish, light/dark appearance and empty/error/valid form states. Locale and appearance also have Storybook toolbar controls.
