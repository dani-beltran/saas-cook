# ADR-0001: Required stack and compatibility baseline

Date: 2026-09-22. Status: selected candidates; execution results in the Phase 0 evidence register control acceptance. This records all 26 required selections from [architecture §2.1](../02-architecture-and-security.md#21-stack-decisions). A published peer range is evidence of a supported mapping, not proof that the complete application works.

## Exact dependency decisions

Versions and declared licenses below were retrieved directly from the public npm registry on the date above. [The metadata snapshot](registry-metadata.json) retains each source URL, integrity, engines, peers and optional-peer flags. Links in the package column resolve version-specific primary metadata. These are direct dependency licenses; shipping artifacts still need a transitive dependency and image SBOM/NOTICE review. Managed services have commercial terms separate from their client licenses.

| # | Required selection | Exact package/version or service contract | Declared license | Mapping and compatibility check |
| --- | --- | --- | --- | --- |
| 1 | Next.js App Router | [next 16.3.5](https://registry.npmjs.org/next/16.3.5) | MIT | Node >=20.9; React/DOM ^19 accepted. Node runtime, Route Handlers, standalone build. |
| 2 | Better Auth | [better-auth 1.7.5](https://registry.npmjs.org/better-auth/1.7.5), @better-auth/passkey 1.7.5 | MIT | Next 16, React 19 and Drizzle 0.45.3 are in published peer ranges. Dedicated identity endpoints; domain services retain lifecycle ownership. SSO/SCIM provider mapping is recorded below. |
| 3 | shadcn/ui | [shadcn 4.21.0](https://registry.npmjs.org/shadcn/4.21.0); checked-in component source | MIT | Node >=20.18.1. Generated source and each added primitive must be reviewed and locked; CLI version alone cannot identify registry content. Record source snapshot/hash on import. |
| 4 | TypeScript | [typescript 7.0.2](https://registry.npmjs.org/typescript/7.0.2) | Apache-2.0 | Strict checks; candidate compiler must pass framework/plugin builds, with no forced peer bypass. |
| 5 | Drizzle ORM / Kit | [drizzle-orm 0.45.3](https://registry.npmjs.org/drizzle-orm/0.45.3), [drizzle-kit 0.31.11](https://registry.npmjs.org/drizzle-kit/0.31.11) | Apache-2.0 / MIT | pg 8.23.0; connection-bound transactions. Stable 0.x selected instead of 1.0 prerelease. |
| 6 | PostgreSQL | 18.6 | PostgreSQL License | Supported major through November 2030; separate application and FGA databases, real restricted roles. [Support policy](https://www.postgresql.org/support/versioning/), [license](https://www.postgresql.org/about/licence/). |
| 7 | oRPC | [@orpc/server 1.15.3](https://registry.npmjs.org/@orpc%2Fserver/1.15.3), client/openapi/zod/contract 1.15.3 | MIT | Keep all oRPC packages on the same release. @orpc/zod accepts Zod >=3.25; use 4.6.5 and the fetch/Next adapters. |
| 8 | Stripe | [stripe 22.6.2](https://registry.npmjs.org/stripe/22.6.2); hosted Billing/Checkout/Portal | MIT SDK; service terms | Node >=18. Fixed/seat subscriptions only by default; pin API/webhook version together when configuring test account. No live billing enabled by Phase 0. |
| 9 | React 19 | [react 19.3.0](https://registry.npmjs.org/react/19.3.0), react-dom 19.3.0 | MIT | Keep renderer versions identical; React DOM requires React ^19.3.0. Match 19.x type definitions. |
| 10 | Tailwind CSS | [tailwindcss 4.3.3](https://registry.npmjs.org/tailwindcss/4.3.3), @tailwindcss/postcss 4.3.3 | MIT | v4 CSS/PostCSS pipeline; verify native binary installation on CI and runtime build architecture. |
| 11 | next-intl | [next-intl 4.14.6](https://registry.npmjs.org/next-intl/4.14.6) | MIT | Published peers include Next 16 and React 19; request locale remains request scoped. |
| 12 | React Email | [@react-email/components 1.0.12](https://registry.npmjs.org/@react-email%2Fcomponents/1.0.12), render 2.1.0, react-email 6.9.5 | MIT | Node >=20; React/DOM 19 accepted; render email on server and inspect localized output. |
| 13 | Zod | [zod 4.6.5](https://registry.npmjs.org/zod/4.6.5) | MIT | Shared explicit input/output DTOs; conversion through @orpc/zod; unknown fields are not authorization context. |
| 14 | React Hook Form | [react-hook-form 7.88.0](https://registry.npmjs.org/react-hook-form/7.88.0), @hookform/resolvers 5.9.1 | MIT | React 19 and Zod 4 accepted; server repeats validation. |
| 15 | Vitest | [vitest 5.0.1](https://registry.npmjs.org/vitest/5.0.1) | MIT | Requires Node ^22.12 / ^24 / >=26. Invoke through Bun scripts, execute on Node. Match coverage/UI packages if added. |
| 16 | Playwright | [@playwright/test 1.63.0](https://registry.npmjs.org/@playwright%2Ftest/1.63.0) | Apache-2.0 | Node >=20; browser revisions installed from this package, not OS browser auto-update. |
| 17 | Storybook | [storybook 10.6.0](https://registry.npmjs.org/storybook/10.6.0), @storybook/nextjs-vite 10.6.0 | MIT | Next 16/React 19 accepted. Use supported Vite release from lockfile; static stories include locale/theme/form errors. |
| 18 | Biome | [@biomejs/biome 2.5.14](https://registry.npmjs.org/@biomejs%2Fbiome/2.5.14) | MIT OR Apache-2.0 | Check native executable for each CI architecture. |
| 19 | Commitlint | [@commitlint/cli 21.2.3](https://registry.npmjs.org/@commitlint%2Fcli/21.2.3), config-conventional 21.2.3 | MIT | Node >=22.12; check both proposed squash title and merged commits in Phase 1. |
| 20 | Lefthook | [lefthook 2.1.14](https://registry.npmjs.org/lefthook/2.1.14) | MIT | Explicit local hook installation; CI never relies on hooks running. |
| 21 | Knip | [knip 6.37.0](https://registry.npmjs.org/knip/6.37.0) | ISC | Node ^20.19 or >=22.12; declare framework/routes/stories/test entry points, explain narrow exclusions. |
| 22 | Bun workspaces | [bun 1.4.2](https://registry.npmjs.org/bun/1.4.2) | MIT package; bundled third-party notices | Exact packageManager plus bun.lock; workspace:* references; reviewed lifecycle-script trust list. Node remains production runtime. |
| 23 | T3 Env | [@t3-oss/env-nextjs 0.13.11](https://registry.npmjs.org/@t3-oss%2Fenv-nextjs/0.13.11), env-core 0.13.11 | MIT | Zod 4/TS >=5 accepted; validate each process; no production secrets at build. |
| 24 | GitHub Actions | Hosted service; action commit pins in [build-tool snapshot](tool-releases.json) | Service terms; each action's upstream license | Keep build jobs free of application credentials. A runner label is not an immutable machine image. |
| 25 | LogTape | [@logtape/logtape 2.3.7](https://registry.npmjs.org/@logtape%2Flogtape/2.3.7) | MIT | Shared structured logs with allowlisted fields and redaction; verify sink behavior. |
| 26 | AGENTS.md | Repository-owned, versioned with the source commit | Repository license decision applies | Instructions describe implemented commands/boundaries; no external runtime/package or invented version. |

## Supporting dependencies and runtimes

Pin Node 24.19.0 for the measured local baseline; Node 24 is LTS and upstream latest LTS was 24.21.0 when checked. Test and adopt the newer patch before production, including review of intervening security fixes. Node 26 is Current and is not the selected production line. [Official Node release status](https://nodejs.org/en/about/previous-releases).

Additional exact candidates from the same metadata snapshot: turbo 2.11.2 (MIT), pg 8.23.0 (MIT), pg-boss 12.33.4 (MIT, Node >=22.12), @openfga/sdk 0.9.7 (Apache-2.0), posthog-node 5.52.5 (MIT), @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner 3.1137.0 (Apache-2.0). OpenFGA server 1.21.0 is Apache-2.0; its selected image/digest and database migration evidence belong in the authorization results.

Identity adapter probes additionally pin [@better-auth/sso 1.7.5](https://registry.npmjs.org/@better-auth%2Fsso/1.7.5) and [@better-auth/scim 1.7.5](https://registry.npmjs.org/@better-auth%2Fscim/1.7.5), both declaring MIT in exact-version registry metadata. Their installation/license mapping is not proof of real enterprise IdP provisioning or lifecycle behavior. The snapshot also records @orpc/contract 1.15.3, tsx 4.23.15 and the exact Node/pg/React type packages from the dependency manifest.

Bun supports workspace package references and a root lockfile; this establishes feasibility of the required layout. The application build still must demonstrate imports across real workspace boundaries. [Bun workspace documentation](https://bun.sh/docs/pm/workspaces). shadcn declares current React 19/Tailwind 4 support; generated components remain source owned by this repository, so record what was actually copied. [shadcn compatibility guidance](https://ui.shadcn.com/docs/react-19).

## Acceptance and update policy

1. Install with the exact Bun version, commit bun.lock, then repeat with `bun install --frozen-lockfile`. Record OS/architecture, Node/Bun versions and native-script decisions. No `--force`, legacy peer bypass or unbounded runtime versions.
2. Compile with strict TypeScript; production-build Next; run typed RPC and OpenAPI validation/error parity; render React Email and localized form stories with React 19. Execute unit/integration/browser runners on the selected Node line. Separate a dependency import probe from a feature acceptance test.
3. A metadata match satisfies only version selection. Runtime, UI, Storybook, CI and application recovery acceptance remain assigned to their roadmap phases; the evidence register states exactly which probes ran.
4. Patch updates are reviewed PRs with regenerated lockfile and relevant regression gates. Security fixes take priority; major updates repeat this matrix and architecture spikes. Preserve release digest/SBOM and old schema/model compatibility evidence for previous-release compatibility.
5. License review covers copied component notices, dependencies, bundled native binaries and base images. No project license existed at selection time; choosing a template distribution license is a maintainer decision and is not inferred from dependency licenses.
