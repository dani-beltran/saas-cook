# Shared UI patterns

Components are checked-in source, consumed by Next.js and Storybook. The form uses native labels, described validation errors, focus-on-error and a status announcement. It validates a browser-only draft; a feature must independently validate and authorize its server mutation.

`src/input.tsx` is adapted from the official shadcn/ui `new-york-v4/input` registry source retrieved on 2026-09-26. The exact response is retained in `vendor/shadcn-input.json` (SHA-256 `b1fffa12ba72ce30a291749012b47235eda110648b8106725ced22b5b31c8f1b`), with the upstream MIT license. Changes: use a type-only React import and a local string-only class combiner; shared semantic surface, density and focus tokens; Biome formatting. Source: <https://ui.shadcn.com/r/styles/new-york-v4/input.json>. The button, sample form, theme and messages are repository-owned patterns; no registry download runs during builds.

Use `bun run storybook` or `bun run storybook:build` from the repository root. Stories cover English/Spanish, light/dark appearance and empty/error/valid form states. Locale, palette, mode, density, typography, radius and shadows have Storybook toolbar controls. See [product appearance](../../docs/development/theming.md) for the developer configuration, CSS token contract and browser verification.

## Shared controls

The `NativeSelect`/`NativeSelectOption`/`NativeSelectOptGroup`, `Textarea`, `Checkbox`, `RadioGroup`/`RadioGroupItem`, `Dialog` family and `Table` family are adapted from the official shadcn/ui `new-york-v4` registry, retrieved on 2026-10-19. Registry URLs follow `https://ui.shadcn.com/r/styles/new-york-v4/<component>.json`. The source snapshots below retain upstream component content and metadata with repository JSON formatting, under the existing MIT notice in `vendor/LICENSE.shadcn.md`.

| Component | SHA-256 of checked-in snapshot |
| --- | --- |
| `native-select` | `b82173d5314c106241fa411d779234e0569d1fa5fd37127432c3ca15a2140a8d` |
| `textarea` | `a8f526a65c34720a740233f3923677a27ef203b1e534cd92e96b181b928036ef` |
| `checkbox` | `f3c42f4677bf3f3dbf63b6ff59883022dbcc61f7f85f28d6127ae2cd6afd7bc2` |
| `radio-group` | `3cd49d87b53e24cec5334c9b0c47a451486a248b9edeecd61cb2960abdae5c62` |
| `dialog` | `e594f6f1ce7932d61bc7d6631c5763f60ac2593b2208198bb6e0432e81c660e0` |
| `table` | `7ed9e489312cce9193627ee6c23e4c8c796435401bb8f095a79d5d401043d8d9` |

Adaptations use type-only React imports, the local class combiner, exact individual Radix dependencies instead of the umbrella package, and the existing semantic color, density, focus, radius and overlay tokens. Selects use the official Native Select variant to preserve native keyboard/mobile selection, empty values, React Hook Form refs and browser form serialization. `wrapperClassName` styles its layout wrapper; ordinary props and refs reach the select. Textarea keeps explicit/resizable height; table cells wrap long content and retain the existing responsive layouts. Build scripts never download registry code.

Dialogs use the Radix portal, focus trap and accessible title/description primitives. Controlled dialogs without a `DialogTrigger` also restore their captured opener; consumers can supply `onCloseAutoFocus` for a disappearing opener. Radio groups retain Radix navigation and complete selection after asynchronous focus when a quick keyup would otherwise leave an unchecked focused item; already-selected items never emit a duplicate change. Each existing feature keeps its own busy-state and outside/Escape dismissal policy and localized close controls. Use `showCloseButton={false}` when supplying those controls.

The existing owned `Button` now includes `ghost`/`link` variants and `plain`/`icon` sizes for navigation, inline and icon actions. `Foundation/Controls` covers form validation, disabled states, serialization and dialog behavior; `Foundation/Theme` exercises the shared portaled dialog across the theme matrix.
