# Working in this repository

This is the Phase 1 Common SaaS foundation. `docs/06-delivery-roadmap.md` is the acceptance register. Read the relevant architecture and data-model contracts before changing a boundary. Phase 0 evidence is retained in `spikes/phase0` and `docs/phase0`; its benchmark and fixtures are not production application code.

## Stack and layout

Use Bun 1.4.2 for the frozen workspace install and root scripts. Node.js 24.19.0 runs local development, Vitest and build tools; the digest-pinned distroless application image runs Node.js 24.21.0. Both are within the supported Node 24 range, and image acceptance checks the final runtime and native dependencies. Exact dependencies and trusted lifecycle scripts are in `package.json` and `bun.lock`; do not replace the lockfile with an npm/pnpm/yarn lockfile.

- `apps/web`: Next.js App Router, React 19, next-intl and the localized application shell.
- `apps/worker`: bounded background process and worker health.
- `packages/ui`: shared shadcn/ui and Tailwind primitives, React Hook Form/Zod example and stories.
- `packages/api-contracts`, `packages/api`: shared Zod/oRPC DTOs, typed client, RPC and OpenAPI handlers.
- `packages/config`, `packages/observability`: separate runtime/client validation, LogTape redaction and OpenTelemetry correlation.
- `packages/db`, `packages/auth`, `packages/email`, `packages/testing`: reviewed Drizzle migrations, identity adapter setup, localized React Email and synthetic fixtures.
- `infra/compose.yaml`: disposable development services. `infra/docker`: the combined non-root application image and command packaging.

## Commands

Run commands from the repository root. Copy `.env.example` for the documented local environment. Use synthetic credentials only with disposable local services.

| Task | Command |
| --- | --- |
| Install | `bun install --frozen-lockfile` |
| Explicit local hooks | `bun run hooks:install` |
| Local services | `bun run services:up` / `bun run services:down` |
| Apply reviewed migrations | `bun run db:migrate` |
| Develop | `bun run dev` |
| Source / formatting | `bun run check` / `bun run format` |
| Strict types / unused code | `bun run typecheck` / `bun run knip` |
| Unit / real-service integration | `bun run test:unit` / `bun run test:integration` |
| Browser | `bun run build`, then `bun run test:e2e` |
| Stories | `bun run storybook` / `bun run storybook:build` |
| Selected model compatibility | `bun run authz:validate` |
| Production build | `bun run build` |
| Image acceptance | `bun run image:build`, then `bun run test:image` |
| Vulnerability checks | `bun run security:scan dependencies` / `bun run security:scan image common-sass:phase1` |
| Historical Phase 0 tests | `bun run phase0:test` / `bun run phase0:test:integration` |

Vitest uses separate `unit` and `integration` projects. Integration tests require running local services and fail rather than silently skipping missing services. `TEST_DATABASE_ADMIN_URL` is only for creating isolated test databases. Production runtime processes must use distinct restricted web/worker roles; migration credentials belong only to the migration command. Test reports and build/scan evidence go under ignored `artifacts/`.

Use Conventional Commits with a header of at most 100 characters. Validate commit messages with `bun run commitlint --from <base> --to <head>`. PR titles must be valid Conventional Commits because the default merge strategy is squash; ordinary merge/revert messages use Commitlint's standard ignores. Lefthook runs the same Biome and Commitlint policies as CI. Hooks do not replace CI.

## Boundaries and verification

Phase 1 diagnostics and form examples do not grant tenant access. Better Auth setup is not an enabled authentication flow. Production identity, membership, RLS, authorization publication/readiness and lifecycle/recovery behavior belong to Phase 2 and later roadmap gates. Never expose Phase 0 fixture identity headers as trusted application authentication. `bootstrap` and `authz-publish` packaging must report unsupported work until their actual Phase 2 protocols exist.

Keep public/client configuration allowlisted and validate server configuration before work starts. Do not use `NEXT_PUBLIC_*` to bake environment-specific settings into the image. Never log credential values, authentication URLs, raw payloads or caller-controlled request IDs. Use the shared logging boundary and correlation fields. Build without application services or credentials.

Do not modify applied migration history. Add a reviewed migration, test a fresh database and upgrade from the previous schema fixture, and preserve role separation. The Phase 1 previous-schema fixture is not a released product upgrade claim.

Knip discovers framework routes, stories, test suites, package exports and command entries. Keep exceptions exact, explained and limited to retained Phase 0 compatibility fixtures or framework-required dependencies; do not ignore entire new packages. Biome excludes the frozen Phase 0 sources and evidence to avoid rewriting historical artifacts; all new application and tooling code is checked. Preserve Phase 0 behavior and run its own Vitest config for changes affecting it.

CI runs source, unit, integration, browser, Storybook, production build and image jobs on PRs and actual `main` commits, with a final `required` gate. Do not describe unrun jobs or deferred capabilities as passed. High/critical dependency and image findings block under `security/README.md`; exceptions require exact scope, review, owner and expiry. Retain diagnostic artifacts when a check fails.
