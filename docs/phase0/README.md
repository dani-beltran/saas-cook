# Phase 0 — Validate decisions

**Status: Phase 0 validation is complete for the template scope.** The [contextual replacement](contextual-authorization.md) passed 33 fault/policy tests and the full reference workload with 99.950% first-attempt success. The image-only scope removes infrastructure ownership, environment confirmation and operational recovery commitments from the exit gate. Later application/image implementation remains planned. The rejected full-copy candidate is retained as historical evidence.

The [roadmap](../06-delivery-roadmap.md) and its stable requirement IDs remain the acceptance authority. These experiments use synthetic data and disposable services. No live billing, customer identities or external messages were created.

## Decisions and evidence

| Work item | Implemented artifact | Assessment |
| --- | --- | --- |
| ARCH-01 | [26-selection version/license matrix](stack-matrix.md), registry metadata, exact Bun lockfile, two-workspace Next/oRPC build | Version mapping and local adapter probes demonstrated; full Phase 1 tooling/runtime acceptance remains due |
| SEC-01 | [Threat model](threat-model.md) | Browser/API/worker/provider trust boundaries, threats, controls and test mapping recorded |
| API adapter | [API/workspace spike](api-and-database.md) | Real oRPC RPC/REST handlers, Zod DTOs/errors, typed inference, OpenAPI and compiled Next HTTP checks |
| DB-01 | [Restricted-role database spike](api-and-database.md#database-boundary) | Real PostgreSQL RLS, transaction-local pool context, tenant FKs, both membership indexes and Drizzle connection binding |
| AUTH-01 | [Identity decision](identity.md) | Real magic-link, WebAuthn and SCIM adapters plus lifecycle race models; application-owned assurance/ownership controls required |
| AUTHZ-01 | [Contextual protocol and fault evidence](contextual-authorization.md) | **Passed for the bounded prototype.** 33 tests including policy parity, revocation, expiry, preflight races, connection loss and HTTP timeout; production lifecycle/recovery acceptance remains due |
| AUTHZ-02 | [Completed reference evidence](contextual-authorization.md#completed-reference-result) | **Passed.** 1,821.6 seconds; 1,658,137 requests; 99.950% first-attempt success; all original latency/deadline/storage gates passed; zero persisted graph writes |
| REC-01 | [Application recovery ADR](recovery.md) | Journal/watermark barrier and independent security revalidation contract defined; implementation and synthetic recovery acceptance remain due in Phase 6 |
| FILE-01 / adapters | [Storage, billing and analytics ADR/spikes](adapters.md) | Immutable version/digest and race contracts; Stripe raw-signature verification; bounded analytics suppression/deletion models. Live provider certification is not claimed |
| Image decision | [Docker image ADR](docker-image.md) | Build boundary and combined application image contract selected; Phase 1 implements and verifies the image |

The [retained validation evidence](evidence/validation.json) records commands, runtime and suite results. Authorization's raw reports are linked from its decision records. Historical failures remain failed/incomplete; the new completed contextual run has its own passing report. The snapshots identify the prototype that ran; subsequent harness hardening is not relabeled as a successful reference benchmark.

The **September 23 rerun** verified the larger Docker memory allocation and 8 GiB PostgreSQL tmpfs, passed all 18 authorization preflight tests, and preserved the full reference workload. It stopped at 1,197,732 retained snapshot tuples against the unchanged 1,000,000 cap, with about 3.83 GiB of filesystem space still free after exit. Its stop checkpoint recorded 7 first-attempt successes and 170 projection-pending failures among 177 requests. These early-stop counts are not full-run performance results. At that point Phase 0 remained unapproved; [the updated authorization conclusion](authorization.md#rerun-with-increased-memory-and-tmpfs-capacity) explains the separate availability and snapshot-retention problems.

The subsequent [snapshot-retention fix](authorization.md#snapshot-retention-fix) passed **21 authorization tests and type checking**. It discards terminal snapshot payloads and discovers late remote writes through resumable OpenFGA scans, preserving namespace tombstones and revocation safety. In the new reference run, 1,103 retired attempts retained zero snapshot tuples and the sampled peak stayed at 306,197 against the unchanged million-tuple guard. The run instead stopped after 51 measured seconds at the unchanged 6 GiB storage guard, with OpenFGA relationship storage and changelog dominating usage. This fixes the local snapshot leak but does not resolve availability or remote cleanup capacity; at that point Phase 0 remained unapproved.

The subsequent **contextual replacement** removes full-copy graph publication. Its completed 30-minute run passed with **69/116 ms read/write p95**, **62 ms fence p95**, no create-read deadline misses, and **658 MiB database-plus-WAL storage**. It recorded 826 first-attempt failures, including 76 eventual failures, and still exceeded the original 99.9% requirement. See the [complete results and limitations](contextual-authorization.md#completed-reference-result).

## Run the spikes

Install **Node 24.19.0**, **Bun 1.4.2**, Docker Engine and Compose. Run from the repository root:

```sh
bun install --frozen-lockfile
bun run phase0:toolchain
bun run phase0:typecheck
bun run phase0:test
bun run phase0:services:up
bun run phase0:test:integration
bun run phase0:build
bun run phase0:storybook
node node_modules/@playwright/test/cli.js install chromium
bun run phase0:browser
```

`phase0:test` explicitly skips real-service suites. Only `phase0:test:integration` exercises PostgreSQL/OpenFGA/provider integration; required services failing to connect fail that run. The provider suites create/truncate only dedicated fixture schemas. Overrides such as `PHASE0_DATABASE_URL`, `AUTHZ_DATABASE_URL` and `OPENFGA_URL` must point to disposable test services. Fixed credentials in Compose are synthetic and ports bind only to `127.0.0.1`.

Bun manages packages/scripts; the scripts explicitly execute on Node. The reviewed lifecycle-script allowlist permits `esbuild` and `sharp` only. Hook installation is deferred to Phase 1; dependency installation must not silently install Git hooks. Generated reports/builds stay in ignored `artifacts/`, `.next/` and `.turbo/` directories. The spike Next app is only a fixture: it uses in-memory synthetic authentication and data.

The browser command owns its local Next process and requires a prior build. For a compiled API check in separate terminals:

```sh
PHASE0_API_FIXTURES=1 bun run --cwd spikes/phase0/api-next start
bun run phase0:api:smoke
```

Stop that local server afterward. Stop disposable services with `bun run phase0:services:down`; their tmpfs data is intentionally discarded. Never use these setup/cleanup commands against a product environment.

## Authorization decision gate

The short smoke tests harness behavior and **always returns a non-passing gate status**, even if individual metrics happen to pass:

```sh
OPENFGA_VERSION=1.21.0 AUTHZ_DOCKER_LIMITS='<actual CPU/memory/storage limits>' bun run phase0:authz:smoke
```

A candidate intended for approval must use the unmodified reference workload: 100 tenants, 1,000 memberships, 100,000 resources, 50 clients, a 50% resource/80% traffic hot tenant, 1% sparse principal, the documented operation mix, warm-up and at least 1,800 measured seconds. Record actual service versions/limits. Do not run competing suites during its measured interval.

```sh
OPENFGA_VERSION=1.21.0 AUTHZ_DOCKER_LIMITS='<actual CPU/memory/storage limits>' bun run phase0:authz:benchmark
```

The default benchmark and smoke scripts now use contextual authorization. `phase0:authz:legacy` reproduces the rejected full-copy candidate. The runner retains progress and enforces storage bounds; shortened or aborted runs cannot pass. Compose permits an 8 GiB tmpfs, while the runner defaults to a separate 2 GiB diagnostic storage guard. The recorded passing run explicitly used `AUTHZ_STORAGE_BUDGET_BYTES=6442450944` (6 GiB), matching the prior reruns. On macOS, keep the lid open and use a process-scoped `caffeinate -i` wrapper for an uninterrupted measurement.

## Phase 0 completion and next work

As of 2026-09-26, the template scope ends at building the application Docker image. The former operational ownership, environment/provider confirmation and recovery-time gates are removed from template acceptance. This scope change adds no new execution evidence and does not relabel historical failed runs.

Authorization selection and its synthetic gate are complete for the documented model. Phase 1 implements the application scaffolding and Docker image. Phase 2 integrates the selected authorization and initialization commands; Phase 3 reruns the reference workload on the real Project slice. Later hardening verifies the application image and expanded fault cases.

Passing fixtures are not a substitute for real application services and image acceptance assigned to those phases.
