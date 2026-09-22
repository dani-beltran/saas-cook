# Phase 0 — Validate decisions

**Status: validation artifacts implemented; exit gate is not met.** The generation-isolated full-copy OpenFGA candidate is rejected on availability and storage evidence. It must be redesigned and pass the original gates before dependent implementation proceeds. Passing the functional spike suite does not approve Phase 0 or deliver a production SaaS application.

The [roadmap](../06-delivery-roadmap.md) and its stable requirement IDs remain the acceptance authority. These experiments use synthetic data and disposable services. No cloud resources, live billing, customer identities, production deployment or external messages were created.

## Decisions and evidence

| Work item | Implemented artifact | Assessment |
| --- | --- | --- |
| ARCH-01 | [26-selection version/license matrix](stack-matrix.md), registry metadata, exact Bun lockfile, two-workspace Next/oRPC build | Version mapping and local adapter probes demonstrated; full Phase 1 tooling/runtime acceptance remains due |
| SEC-01 | [Threat model](threat-model.md) | Browser/API/worker/provider trust boundaries, threats, controls and test mapping recorded |
| API adapter | [API/workspace spike](api-and-database.md) | Real oRPC RPC/REST handlers, Zod DTOs/errors, typed inference, OpenAPI and compiled Next HTTP checks |
| DB-01 | [Restricted-role database spike](api-and-database.md#database-boundary) | Real PostgreSQL RLS, transaction-local pool context, tenant FKs, both membership indexes and Drizzle connection binding |
| AUTH-01 | [Identity decision](identity.md) | Real magic-link, WebAuthn and SCIM adapters plus lifecycle race models; application-owned assurance/ownership controls required |
| AUTHZ-01 | [Authorization protocol and fault evidence](authorization.md) | Generation isolation and lost-lock/late-write fixtures demonstrated; not production lifecycle/recovery acceptance |
| AUTHZ-02 | [Authorization performance evidence](authorization.md) | **Rejected.** Clean smoke availability far below 99.9%; reference-scale run exhausted storage and did not complete 30 minutes |
| REC-01 | [Independent recovery ADR](recovery.md) | Failure domains, journal/watermark barrier, security revalidation and conditional recovery feasibility defined; human ownership/response commitments remain open |
| FILE-01 / adapters | [Storage, billing and analytics ADR/spikes](adapters.md) | Immutable version/digest and race contracts; Stripe raw-signature verification; bounded analytics suppression/deletion models. Live provider certification is not claimed |
| Deployment decision | [Host, registry, CI trust and ownership ADR](deployment.md) | Concrete Docker/AWS/GHCR reference design and version pins; real owner assignments and environment/provider confirmation outstanding |

The [retained validation evidence](evidence/validation.json) records commands, runtime and suite results. Authorization's raw reports are linked from its decision record and deliberately retain their failed/incomplete status. The snapshots identify the prototype that ran; subsequent harness hardening is not relabeled as a successful reference benchmark.

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

Bun manages packages/scripts; the scripts explicitly execute on Node. The reviewed lifecycle-script allowlist permits `esbuild` and `sharp` only. Hook installation is deferred to Phase 1; dependency installation must not silently install Git hooks. Generated reports/builds stay in ignored `artifacts/`, `.next/` and `.turbo/` directories. Do not deploy the spike Next app: it deliberately uses in-memory synthetic authentication and data.

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

The default runner retains progress and enforces its documented storage bounds. A shortened/aborted run cannot pass; first-attempt failures remain visible separately from retries. The current candidate is already rejected; increasing its storage alone does not resolve measured projection-induced unavailability. See [authorization follow-up work](authorization.md) before another expensive reference run.

## Work required to close Phase 0

1. Select and prove an authorization design meeting the original correctness, availability and storage requirements. Update the canonical architecture, logical schema and future skill guidance together; rerun the full gate. Never substitute a mutex around mutable remote writes or weaken revocation.
2. Confirm accountable deployment/recovery owners, actual environment identity and provider/region availability. The ADRs provide concrete defaults and role separation; they do not invent personal assignments or authorize cloud spend.
3. Resolve the conditional end-to-end recovery objective. Human identity/owner revalidation has no demonstrated four-hour bound. Record the chosen response process and revised cost/effort before promising it.

Phase 1 production scaffolding and later feature gates remain planned. The experiments inform that implementation; passing fixtures are not a substitute for the real services and release acceptance assigned to those phases.
