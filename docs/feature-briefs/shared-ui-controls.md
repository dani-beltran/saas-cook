# Shared dashboard controls

Date: 2026-10-19. Requirement: `UI-01`.

Replace the native controls identified in the dashboard audit with owned shared shadcn/ui components. This covers the production and pattern shells, organization settings, Projects, example Customers, billing, account appearance/upload controls and authentication actions. Existing services, permissions, form values, query/navigation behavior and localized text remain the contracts.

Use shadcn's Native Select variant to retain empty options, native keyboard/mobile behavior, browser form data and React Hook Form refs. Add shared Textarea, Radix Checkbox/RadioGroup/Dialog and semantic Table components. Adapt the existing Button for inline/icon actions. Preserve responsive feature styling, form validation/error focus, described controls, disabled/pending states, controlled dialog dismissal and opener restoration (including the deleted-customer fallback). All audited native controls now live behind the shared UI boundary.

Official registry source snapshots, hashes, license and local adaptations are recorded in `packages/ui/README.md` and `packages/ui/vendor/`. Dependencies are exact and locked with Bun 1.4.2. No migrations, authorization or server behavior changed.

The browser suite caught and guided fixes for a hidden file input expanding the page and for Radix's asynchronous radio focus missing selection after a rapid keyup. The shared radio component selects an unchecked destination after Radix moves focus; a checked destination emits no duplicate change. Existing production keyboard tests remain unchanged, and a component test asserts exactly one selection change.

## Verification

Baseline: `25a736014e6c04eadbc3a6510896cb88d3e04307`, initially clean working tree. Executor: Codex, GPT-6; exact serving model identifier and runtime reasoning configuration are unavailable. Skills: repository-local `saas-add-dashboard-page` and `saas-verify-feature`, as read during this task. No subagents or live-agent evaluations were run.

Final command outcomes are recorded below. Diagnostic command logs are retained under ignored `artifacts/ui-*.log`, including failed attempts and reruns. This is UI/application evidence, not authorization, image or release acceptance.

Implementation fingerprint: `c54d9949eaf669171bdf2a8e47feba50b6cbe5ca24c6b5035fc4a3c79019c170`. Build/test fingerprint before restoring Next.js-generated declaration paths: `46a2418fd68cd36be7252a4b7841799468c05e711aef2626a5e10738be1058a8`. It uses the repository's `sourceFingerprint()` and includes the new source snapshots. Full diff retained in `artifacts/ui-source.diff`; reports and screenshots are under `artifacts/theme/`, `artifacts/playwright-results/`, `artifacts/dashboard-redesign/screenshots/` and `artifacts/security/`.

| Command | Outcome |
| --- | --- |
| `bun install --frozen-lockfile` | Passed, unchanged lockfile after dependency addition |
| `bun run check` | Passed |
| `bun run typecheck` | Passed |
| `bun run knip` | Passed |
| `bun run test:unit` | 158 passed |
| `bun run build` | Passed |
| `bun run storybook:build` | Passed |
| `bun run test:theme` | 17 passed; quick-arrow selection emits one change |
| `bun run test:e2e` | 45 passed across the full isolated-installation suite |
| `bun run security:scan dependencies` | Passed with prescribed checksum-verified Trivy 0.69.3 and current digest-verified database |

The scanner was absent from PATH; a temporary checksum-verified installation was used. Its OCI transfer stalled, so the current official mirrored DB layer was downloaded through a working HTTP transfer, verified against digest `sha256:11aa5ef22c17e398e05f04fb7d422258aca2e8c22a1e7a0bf5e702f9de13368a`, and supplied to the unchanged dependency gate. DB update time: 2026-10-19T13:35:30Z. The scan included development dependencies and passed without exceptions. Initial failed-attempt logs remain under `artifacts/ui-*.log`; only the final runs above establish passing evidence. One early production run also overlapped a rebuild; the final suite ran after the completed build.

No standalone integration, historical Phase 0, image or live-agent evaluation gates were run or claimed.

Skill source hashes: dashboard `a3438b7546328a3c533269ff2840d86401fcfe229ec662e655f3a9fdf522c09d`; verification `b04e4f07b2a155c895ba16a82dba04c93e45c087e15658b1a0e38e190d223d62`.

The build changed only the generated paths in `apps/web/next-env.d.ts`; those declarations were restored to their existing development paths, and typecheck passed again afterward.
