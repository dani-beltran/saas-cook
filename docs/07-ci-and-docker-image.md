# 7. CI and Docker image build

## 7.1 Scope and deliverables

The template produces one Docker application image containing the Next.js web server and Node.js background worker. Infrastructure and operation are outside the template scope. PostgreSQL, OpenFGA, object storage and enabled providers are external dependencies configured at runtime.

**Status: planned.** Phase 1 implements the Dockerfile, entrypoint and CI image checks. The existing Phase 0 Next.js app is a synthetic fixture, not the template application.

| Path | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | Source checks, application build and Docker image verification |
| `infra/docker/Dockerfile`, `.dockerignore` | Multi-stage build with one final `app` target |
| `infra/docker/entrypoint.sh`, `infra/docker/healthcheck.js` | Supervise web/worker, forward signals, expose packaged command modes and check combined health |
| `package.json`, `bun.lock`, `turbo.json` | Pinned package manager, dependencies and workspace build tasks |
| `packages/config/` | Separate build inputs and validated runtime configuration |

## 7.2 Continuous integration

Run required checks for pull requests and the exact merged commit on the protected default branch. Use Bun for package management and workspace script invocation, with Node.js LTS as the application/tool runtime where required. The planned command contracts are:

| Command | Implementation and purpose |
| --- | --- |
| `bun install --frozen-lockfile` | Reproduce the committed `bun.lock` without changing dependency resolution |
| `bun run check` | Biome CI checks for formatting and lint; `bun run format` provides local formatting |
| `bun run typecheck` | Strict TypeScript checks, including oRPC client/contract inference |
| `bun run commitlint --from <base> --to <head>` | Commitlint Conventional Commits validation for the applicable commit range |
| `bun run knip` | Detect unexplained unused files, exports and dependencies across configured workspaces |
| `bun run test:unit` | Vitest unit suites |
| `bun run test:integration` | Vitest suites using real isolated data/authorization services |
| `bun run test:e2e` | Playwright end-to-end suites |
| `bun run storybook`, `bun run storybook:build` | Storybook local component development and CI static build |
| `bun run authz:validate` | OpenFGA model and assertion validation |
| `bun run build` | Production package and Next.js builds |
| `bun run hooks:install` | Explicit Lefthook installation during local setup |

Lefthook runs Biome checks before commit and Commitlint against the commit message in `commit-msg`. Hooks invoke the same policies as CI. CI checks the PR commit range and proposed squash title, then validates actual new default-branch commits; define squash/merge conventions in `commitlint.config.ts` and fetch enough history to resolve the checked range. Knip configuration includes Next.js routes, oRPC registries, Storybook stories, React Email templates, tests and tooling entry points; document narrow exceptions rather than ignoring whole packages. `AGENTS.md` documents this setup and these commands.

1. Install pinned Node.js/Bun versions and dependencies using `bun install --frozen-lockfile`; cache dependencies with `bun.lock` and tool-version keys. Review dependency lifecycle scripts and Bun trust configuration, and verify required native/tool setup during Phase 0. Install Playwright browser dependencies explicitly for browser jobs. Run Biome, TypeScript, Commitlint, Knip, Vitest unit tests, authorization validation, Storybook and production builds.
2. Start disposable PostgreSQL, OpenFGA with its own database, object storage, and mail capture. Apply migrations to both an empty database and a previous-release fixture. Use real restricted runtime roles and the two-organization synthetic fixtures.
3. Run the applicable Vitest integration and Playwright browser suites for tenant isolation, authorization, entitlements/capacity, API keys and workers. Exercise Zod input/output contracts and policy/error parity through the oRPC RPC and public OpenAPI handlers, next-intl rendering and React Hook Form validation, T3 Env startup rejection, and LogTape redaction. Phase 2 adds Better Auth magic-link/passkey/ownership-transfer suites and React Email rendering/delivery. Phase 4 adds skill-artifact validation, customization/evolution checks and reference/agent-authored feature coverage; isolated skill behavior evaluations produce separate versioned release evidence rather than requiring a live AI service in ordinary CI. Phase 5 adds Stripe billing/checkout/portal/webhook suites. Phase 6 adds product-analytics attribution/controls/deletion and multi-organization account-closure/ownership-continuity recovery suites; later presets add their required module suites. Do not report an unimplemented capability as passed.
4. Build the combined `app` image and exercise startup, static assets, web/worker health, child-process failure, graceful shutdown and packaged one-off command modes against disposable services.
5. Check dependencies and built images against the recorded vulnerability policy; block critical/high findings unless a reviewed, owned, expiring exception applies. Preserve Vitest/Playwright reports, Storybook build output, migration results, and scan evidence with the workflow run.

Pull-request jobs have read-only repository access and no application secrets. Pin third-party Actions to reviewed commit SHAs. Never run untrusted pull-request code in a privileged release job.

## 7.3 Image contents and build

Use a supported Node.js LTS base pinned by digest. A dependency stage installs the pinned Bun binary and runs `bun install --frozen-lockfile`; a build stage compiles the application and packages. Verify native dependencies against the final Node runtime.

The final/default `app` target contains the Next.js standalone server, static/public assets, compiled worker, production dependencies, reviewed SQL migrations and authorization model tooling. Configure Next.js standalone output with the monorepo tracing root and verify the emitted server path. Package `serve`, `migrate`, `bootstrap` and `authz-publish` modes; one-off modes exit without starting web/worker and require no runtime package installation.

Run as a non-root user. The `serve` entrypoint supervises both children, forwards termination signals, drains bounded work and exits nonzero if either child unexpectedly fails. Send logs to stdout/stderr. Include a bounded healthcheck for web readiness, worker heartbeat and application readiness. Keep web and worker database credentials distinct; migration and model-publication credentials belong only to their command modes.

Exclude `.git`, local dependencies, `.env*`, credentials and generated test output from the build context. Supply application credentials at runtime; private package credentials use BuildKit secret mounts. Build inputs must not require access to live application services. Validate server/client configuration separately and keep secrets out of browser assets. Environment-specific browser settings use allowlisted runtime configuration instead of values frozen into `NEXT_PUBLIC_*` during compilation.

Planned build command from the repository root:

```sh
docker build --file infra/docker/Dockerfile --target app --tag common-sass:local .
```

Record the source commit, base image digest, Node/Bun versions, target architecture, image identity and verification results with the build artifact. Test each claimed architecture. CI builds locally without requiring a registry or cloud account.

## 7.4 Image acceptance

Phase 1 verifies the image against disposable dependencies: startup, assets, configuration rejection, combined health, child failure, shutdown, and availability of one-off command modes. Phase 2 verifies real migration/bootstrap/model commands, including resumable initialization and rejection of existing or restored data as a fresh installation. These are application command invariants tested through the image.

Later feature suites run against the built image as their modules become available. Preserve source checks, integration/browser results, dependency/image scans and build metadata. A successful image build does not imply that unimplemented modules have passed their acceptance gates.
