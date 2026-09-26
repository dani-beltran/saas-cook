# Phase 1: repository and runtime

Phase 1 implements `DEV-01` through `DEV-05`, the `UI-01` patterns, the `API-01` skeleton, and the image portion of `R-IMAGE`. The application is a runnable foundation with synthetic diagnostics. Authentication, tenant access, production authorization, initialization and recovery remain Phase 2 work; the shell does not claim to provide those controls.

## Run locally

Use Bun **1.4.2**, Node.js **24.19.0** and Docker with Compose. Dependencies and images are pinned. No commercial credentials are needed.

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run hooks:install
bun run services:up
bun run db:migrate
bun run dev
```

Open `http://localhost:3000`. The shell supports `/en` and `/es`, light/dark themes and keyboard navigation. Organization choices are labeled synthetic fixtures. Switching organizations clears the draft, validation and success state. The sample form validates locally and does not save domain data.

`APP_NAME` and `DEFAULT_LOCALE` are validated at startup and read at runtime, so the same image can be promoted without embedding environment-specific browser values. `DATABASE_URL` and `WORKER_DATABASE_URL` use separate restricted roles. The development launcher removes migration/admin credentials before starting children; the image rejects those credentials in `serve` mode.

| Local dependency | Address | Purpose |
| --- | --- | --- |
| PostgreSQL 18.6 | `127.0.0.1:55433` | Separate migrator, web, worker and identity roles; separate application and OpenFGA databases |
| OpenFGA 1.21.0 | `http://127.0.0.1:18081` | Selected Phase 0 model validation; no production publication yet |
| SeaweedFS 4.17 | `http://127.0.0.1:19000` | S3-compatible disposable fixture; no immutable-file acceptance claim |
| Mailpit 1.29.4 | `http://127.0.0.1:8026`, SMTP `1026` | Local mail capture; identity delivery is Phase 2 |

All published ports bind to loopback. Credentials in `.env.example` and `infra/` are public synthetic values for these disposable services. PostgreSQL and object storage use tmpfs; stopping/recreating services discards their data. Run `bun run services:down` to remove the local containers.

## Implemented boundaries

- `packages/config` uses T3 Env/Zod per process and an explicit public configuration allowlist. Invalid database URLs, origins, public configuration and privileged credentials fail before application work.
- `packages/api-contracts` defines strict input/output DTOs. The typed oRPC client, RPC route, REST route and generated OpenAPI use one public diagnostic service. Caller-supplied identity/tenant fields are rejected. Tests cover invalid input, output validation, DTO shape and error parity. API routes never trust a fixture identity header.
- `packages/db` contains reviewed Drizzle SQL plus separate runtime privileges. Migrations run under `common_saas_migrator`, use a bounded advisory lock, and provision the diagnostic queue. The tests cover fresh migration, replay and upgrade from the first schema fixture with data preserved. This is not a previous product release claim.
- `packages/auth` configures the Better Auth/Drizzle adapter and identity tables without mounting sign-in endpoints. `packages/email` renders English/Spanish React Email previews; real identity/security journeys remain Phase 2.
- `apps/worker` uses pg-boss with migration/DDL disabled, queue supervision enabled and automatic reindex disabled. A diagnostic job carries request/trace references and writes an idempotent receipt. Real tests reclaim an abandoned active job and verify duplicate handling and graceful drain. Domain job authorization is added with the domain services.
- `packages/observability` emits LogTape JSON with a fixed event name and allowlisted operational fields. Credentials, authentication URLs, raw error messages and arbitrary payloads are excluded. OpenTelemetry spans and W3C trace propagation correlate request/job logs; no external telemetry account is required. A production exporter can be attached to the provider without changing callers.
- `packages/ui` retains the imported shadcn Input source, checksum and MIT notice. Next.js and Storybook reuse the RHF/Zod, locale, theme and accessibility patterns.

## Verify

```sh
bun run check
bun run typecheck
bun run knip
bun run test:unit
bun run test:integration
bun run authz:validate
bun run build
node node_modules/@playwright/test/cli.js install chromium
bun run test:e2e
bun run storybook:build
bun run image:build
bun run test:image
bun run security:scan dependencies
bun run security:scan image common-sass:phase1
```

Security scans require the checksum-verified Trivy version in [the scanner policy](../../security/README.md); CI installs it explicitly. Scans include development dependencies and block all high/critical findings without an exact reviewed exception. Local hooks invoke the same Biome/Commitlint policies as CI. `knip.config.ts` documents narrow exceptions for retained Phase 0 compatibility probes.

CI runs source, unit, integration, browser, Storybook, production and image checks, then the `required` aggregate. Set that job as a required branch-protection check in the hosting repository. Workflows use read-only permissions, pinned Actions and no application credentials. Configuring remote branch protection is outside this source change.

## Image contract

`bun run image:build` builds `common-sass:phase1` from the exact frozen workspace input, records the current Git revision and labels an implementation fingerprint. `bun run test:image` rejects an image whose fingerprint no longer matches the implementation. The fingerprint includes app/package/runtime/tooling sources and excludes documentation/evidence to avoid a self-referential report. No new commit is created by these commands.

The build uses Node **24.19.0** and Bun **1.4.2**. The final non-root image uses the digest-pinned official distroless Node **24.21.0** runtime on Debian 13. This supported Node 24 patch update avoids the high/critical findings in the initial Debian 12 slim runtime. The final image has no shell or package installer. Acceptance executes the bundled native Sharp library on the final runtime, as well as the application and command paths. Only the locally tested architecture is claimed in the retained evidence; CI independently builds/tests Linux amd64.

| Mode | Phase 1 behavior |
| --- | --- |
| `serve` (default) | Validate configuration, start web/worker with separate credentials, propagate termination, enforce a shutdown deadline, fail if either child exits unexpectedly |
| `migrate` | Run real reviewed SQL and pg-boss setup; replay is safe; requires only migration credentials |
| `bootstrap --help` | Document the packaged Phase 2 command; execution without `--help` fails without changing state |
| `authz-publish --help` | Document the packaged Phase 2 command; execution without `--help` fails without changing state |

The Docker healthcheck requires web/database readiness and a fresh heartbeat from the live worker process. This Phase 1 readiness does not attest to tenant authorization or independent recovery readiness. Test containers verify missing/malformed configuration, static/public assets, native code, credential separation, stale heartbeat, both child failures, redacted output and graceful shutdown. Command modes never launch web/worker.

Reports are written under `artifacts/`: Vitest JUnit, migration results, Playwright reports/screenshots, Storybook output, OpenFGA assertions, image identity/acceptance and vulnerability scan results. The checked-in [acceptance record](acceptance.md) summarizes the executed results and their limits. GitHub workflow execution itself requires pushing this change; local success does not claim a completed hosted workflow.
