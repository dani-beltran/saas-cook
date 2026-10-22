# Working in this repository

This is the SaaS Cook foundation with Phase 4 repository-local authoring skills. `docs/06-delivery-roadmap.md` is the acceptance register. Read the relevant architecture and data-model contracts before changing a boundary. Phase 0 evidence is retained in `spikes/phase0` and `docs/phase0`; its benchmark and fixtures are not production application code.

## Stack and layout

Use Bun 1.4.2 for the frozen workspace install and root scripts. Node.js 24.19.0 runs local development, Vitest and build tools; the digest-pinned distroless application image runs Node.js 24.22.0. Both are within the supported Node 24 range, and image acceptance checks the final runtime and native dependencies. Exact dependencies and trusted lifecycle scripts are in `package.json` and `bun.lock`; do not replace the lockfile with an npm/pnpm/yarn lockfile.

- `apps/web`: Next.js App Router, React 19, next-intl and the localized application shell.
- `apps/backoffice`: optional private staff application; separate identity/model, exact-org audited metadata lookup and image. See `docs/backoffice/implementation.md`; release gates remain separately tracked.
- `apps/worker`: bounded background process and worker health.
- `packages/ui`: shared shadcn/ui and Tailwind primitives, React Hook Form/Zod example and stories.
- `packages/api-contracts`, `packages/api`: shared Zod/oRPC DTOs, typed client, RPC and OpenAPI handlers.
- `packages/config`, `packages/observability`: separate runtime/client validation, LogTape redaction and OpenTelemetry correlation.
- `packages/db`, `packages/auth`, `packages/email`, `packages/testing`: reviewed Drizzle migrations, tenant lifecycle/RLS/seat services, Better Auth identity and assurance, encrypted identity emails and synthetic fixtures.
- `packages/authz`: bounded contextual OpenFGA compiler, independent epoch/readiness and signed operator approval verification.
- `packages/db/src/billing`, `files`, `bulk`, `platform`, `analytics`, `settings` and `lifecycle`: billing/usage, private files, data jobs, discovery/notifications, analytics, organization settings and deletion services. Consult [module availability](docs/development/module-availability.md), [Phase 5](docs/phase5/README.md) and [Phase 6](docs/phase6/README.md) for configuration, extension boundaries and acceptance status.
- `infra/compose.yaml`: disposable development services. `infra/docker`: the combined non-root application image and command packaging.

## Commands

Run commands from the repository root. Copy `.env.example` for the documented local environment. Use synthetic credentials only with disposable local services.

| Task | Command |
| --- | --- |
| Install | `bun install --frozen-lockfile` |
| Explicit local hooks | `bun run hooks:install` |
| Local services | `bun run services:up` / `bun run services:down` |
| Apply reviewed migrations | `bun run db:migrate` |
| Fresh initialization / validate publication | `bun run bootstrap` / `bun run authz:publish` |
| Upgrade a ready Phase 2 or Phase 3 predecessor model | `bun run authz:upgrade` |
| Resource performance smoke / full gate | `bun run authz:smoke` / `bun run authz:benchmark` |
| Scoped operator commands | `bun run owner:recover --approval <file>` / `bun run security:deactivate --approval <file>` |
| Develop | `bun run dev` |
| Source / formatting | `bun run check` / `bun run format` |
| Strict types / unused code | `bun run typecheck` / `bun run knip` |
| Unit / real-service integration | `bun run test:unit` / `bun run test:integration` |
| Browser | `bun run build`, then `bun run test:e2e` |
| Stories | `bun run storybook` / `bun run storybook:build` |
| Selected model compatibility | `bun run authz:validate` |
| Skill contracts / migration and real-service boundaries | `bun run skills:check` (`--static` for source-only checks) |
| Isolated skill behavior evaluation | `bun run skills:evaluate` (see `docs/phase4/evaluation.md`) |
| Production build | `bun run build` |
| Image acceptance | `bun run image:build`, then `bun run test:image` |
| Vulnerability checks | `bun run security:scan dependencies` / `bun run security:scan image saas-cook:phase2` |
| Historical Phase 0 tests | `bun run phase0:test` / `bun run phase0:test:integration` |

Billing catalogue, reconciliation, diagnostics and usage rebuild commands are documented in [Phase 5](docs/phase5/README.md). Independent control-schema, recovery/fingerprint, analytics-report and flag commands are documented in [Phase 6 recovery](docs/phase6/recovery.md) and [platform modules](docs/phase6/platform-modules.md). Use each command's scoped credentials and prerequisites.

Vitest uses separate `unit` and `integration` projects. Integration tests require running local services and fail rather than silently skipping missing services. `TEST_DATABASE_ADMIN_URL` is only for creating isolated test databases. Production runtime processes must use distinct restricted web/worker roles; migration credentials belong only to the migration command. Test reports and build/scan evidence go under ignored `artifacts/`.

Use Conventional Commits with a header of at most 100 characters. Validate commit messages with `bun run commitlint --from <base> --to <head>`. PR titles must be valid Conventional Commits because the default merge strategy is squash; ordinary merge/revert messages use Commitlint's standard ignores. Lefthook runs the same Biome and Commitlint policies as CI. Hooks do not replace CI.

## Boundaries and verification

Document exported functions with JSDoc-style comments that make the interface understandable to a junior developer. Explain the function's purpose, parameters and return value, including relevant constraints, side effects and errors callers must handle. For functions that are not exported, add only a brief comment when the intent is unclear from the function name.

Production identity and tenancy use the Phase 2 services. Derive actors only from verified Better Auth sessions and revalidate them under lifecycle fences. User lifecycle fences precede organization locks; never upgrade a held shared organization fence. Organization routes select context; browser preferences cannot authorize it. Never expose Phase 0 fixture identity headers. All possible positive organization/team/Project decisions use the pinned model and a fresh contextual OpenFGA namespace. Contextual source changes publish revisions atomically; no production permission tuples are persisted.

The separate control store owns installation epochs/readiness and signed operator approvals. Ordinary runtime control access uses its read-only role; enabled platform modules additionally use the restricted journal-writer role for bounded independent journal/analytics functions and a separate restricted application lifecycle role. These roles do not grant runtime control-administrator or recovery authority. `bootstrap` only accepts a fresh installation or its recorded interrupted initialization; existing/restored data must not be treated as fresh. Operator recovery requires a bounded Ed25519-signed independent approval and fresh MFA. The Phase 6 restore/deletion journal protocol is implemented in `packages/authz/src/{journal,recovery}.ts` and `packages/db/src/lifecycle`; see `docs/phase6/recovery.md`. See `docs/phase2/authorization.md` and `docs/phase3/README.md`. Phase 3 uses explicit `authz:upgrade` for the reviewed predecessor model; it never clears recovery state.

Resource mutation services own current principal authorization, capacity, scoped idempotency, versions and audit/outbox atomically. API keys require declared endpoint capabilities and current same-tenant key/account/grant checks. Project lists use encrypted actor/tenant/query-bound cursors after the last scanned candidate; empty pages may continue and never expose unrestricted totals. Preserve the final transaction-wide expiry guard across every authorization batch. Disabled Projects allow reads and cleanup, but reject new positive mutations.

Use shared, browser-safe Zod schemas in `packages/api-contracts` for input structure and value constraints consumed across UI, API and services. Derive input types from those schemas and compose boundary-specific schemas instead of duplicating validation rules. Server boundaries must validate independently of browser checks. Preserve service-owned authorization, transactional invariants, cryptographic/network verification and database constraints; schema validation does not replace them. Keep domain-specific differences explicit rather than forcing unrelated inputs into one schema.

Billing entitlements derive from reconciled, confirmed provider state and bounded validity; redirects and requested upgrades grant no paid access. Persist durable commands before provider calls, preserve their idempotency keys across retries, and reconcile through the existing inbox/projection services. Usage history is append-only; corrections append linked adjustments rather than rewriting events. Local policy and commercial restrictions intersect. Follow the [Phase 5 contracts](docs/phase5/README.md) before changing billing or quota boundaries.

Feature-owned UI translations live in `apps/web/src/i18n/messages/{locale}/{feature}.json`; `apps/web/src/i18n/catalogs.ts` supplies the selected catalog to server requests, the client provider and Storybook. Use next-intl keys and complete ICU messages for counts and summaries. Preserve existing shared messages in `packages/ui/src/messages.ts` and run the catalog unit suite when changing catalogs or locale registration. See [feature workflow](docs/development/feature-workflow.md) for the maintained source map.

Keep public/client configuration allowlisted and validate server configuration before work starts. Do not use `NEXT_PUBLIC_*` to bake environment-specific settings into the image. Never log credential values, authentication URLs, raw payloads or caller-controlled request IDs. Use the shared logging boundary and correlation fields. Build without application services or credentials.

Do not modify applied migration history. Add a reviewed migration, test a fresh database and upgrade from the previous schema fixture, and preserve role separation. The Phase 1 previous-schema fixture is not a released product upgrade claim.

Knip discovers framework routes, stories, test suites, package exports and command entries. Keep exceptions exact, explained and limited to retained Phase 0 compatibility fixtures or framework-required dependencies; do not ignore entire new packages. Biome excludes the frozen Phase 0 sources and evidence to avoid rewriting historical artifacts; all new application and tooling code is checked. Preserve Phase 0 behavior and run its own Vitest config for changes affecting it.

CI runs source, unit, integration, browser, Storybook, production build, image and monetization jobs on PRs and actual `main` commits, with a final `required` gate. Do not describe unrun jobs or deferred capabilities as passed. High/critical dependency and image findings block under `security/README.md`; exceptions require exact scope, review, owner and expiry. Retain diagnostic artifacts when a check fails.

## Feature authoring skills

Canonical skills live in `.agents/skills`: `saas-bootstrap`, `saas-add-feature`, `saas-evolve-feature`, `saas-add-dashboard-page`, `saas-add-email` and `saas-verify-feature`. Read the relevant skill when starting that workflow. [Discovery and manual adapters](docs/development/agent-skills.md) keep one source; [feature workflow](docs/development/feature-workflow.md) maps the actual implementation. Record material product decisions in `feature-briefs/` without introducing an entity DSL or source regeneration.

Feature code stays developer-owned. Inspect actual source, customizations and migration state on resume; satisfied repeated requests add no duplicate migrations or registrations. [Module availability](docs/development/module-availability.md) distinguishes local Foundation services from unimplemented commercial modules. Unknown dependencies fail closed. [Verification](docs/development/verification.md) separates deterministic application checks from live-agent behavior evaluations; neither replaces the other. Evaluator expectations and initial migration/source hashes stay outside candidate edits.
