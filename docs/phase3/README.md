# Phase 3: resource authorization and Project

Phase 3 adds the Project reference feature, optional workspaces, service accounts and API keys, local capacity reservations, and the matching public API. See [acceptance](acceptance.md) for executed checks and remaining gates. The production implementation remains separate from the historical Phase 0 prototype.

## Running and upgrading

Use the pinned Bun/Node versions and local services described in the [Phase 2 setup](../phase2/README.md). Fresh installations run `bun run db:migrate` then `bun run bootstrap`. Existing ready Phase 2 installations run:

```sh
bun run db:migrate
bun run authz:upgrade
bun run authz:publish
```

These commands require the dedicated migration and independent control-administrator credentials. `authz:upgrade` installs the reviewed successor of the pinned Phase 2 model; it validates the existing installation binding, epoch, source readiness and predecessor hash. It keeps an independent resumable model-upgrade receipt, drains organization fences, and replaces the local and independent pinned model references. A partial publication denies requests until the command resumes. It never rotates credentials, reinitializes populated data, clears recovery-required state, or approves restored relationships. `bootstrap` remains the fresh-installation command; `authz:publish` remains validation-only. The image exposes `authz-upgrade` alongside the existing command modes.

Coordinate the existing-installation upgrade in a maintenance window: drain the old web/worker processes, apply the migration and model upgrade with the new image, validate publication, then start the new runtime. Old binaries reject the successor model hash, and new binaries reject an unupgraded predecessor; mixing them is intentionally unavailable. Retry an interrupted model upgrade using the same installation instead of bootstrapping it again.

The organization page links to **Projects**. Interactive clients use the shared oRPC client; both `/api/rpc` and `/api/v1/organizations/{organizationId}/...` call the same services. `/api/openapi` publishes the generated contract. Browser mutations require the configured origin. API keys use `Authorization: Bearer <secret>` and remain pinned to one organization; a bearer header never falls back to a session cookie.

Runtime settings are server-only:

- `WORKSPACES_ENABLED=true` enables workspace operations. Disabling it refuses workspace endpoints and new assignments; existing attached Projects retain their original inherited authorization. Reparent existing Projects before removing the module permanently.
- `DEFAULT_PROJECT_CAPACITY=100` initializes the local Project bucket. A nonnegative integer is a limit; `unlimited` is explicit. These settings do not require or simulate billing-provider credentials. Existing tenant policy is changed through the authorized `setProjectPolicy` domain command, not by changing a runtime default.

## Resource and policy boundary

`packages/db/src/resources.ts` owns the bounded domain transaction, capacity, idempotency, DTOs, audit and outbox writes. `packages/authz/src/resources.ts` owns current identity/membership or key eligibility, independent readiness, source compilation and OpenFGA evaluation. Every possible positive decision uses the pinned model, higher consistency and fresh organization/epoch/request namespaces. No permission tuples or graph snapshots are persisted.

Sorted user lifecycle fences precede the organization fence. Reads and ordinary edits hold a shared organization fence; create/delete/restore, sharing, workspace moves and other authorization changes acquire the exclusive fence initially. They never upgrade a shared lock. Protected SQL, expiry verification and commit use the same live connection as the fence. Authoritative source revisions advance atomically with mutations. Publication/readiness is checked again after remote authorization; a late allowed response cannot survive loss of the database transaction. A final database-time guard before commit checks the earliest positive-source expiry across every decision in the transaction, including earlier list batches and both sides of a move.

Owners and admins manage tenant content. Ordinary members can create Projects and receive an initial manager grant; membership alone does not reveal another member's private Project. Viewer/editor/manager grants may target a same-tenant membership or non-nested team. Explicit denial prevents an otherwise inherited grant from authorizing that principal. An administrator remains the documented content administrator. Expiring grants use database time, with a second check after remote evaluation. Unsupported graphs and oversized contexts fail closed.

Workspace grants inherit to attached Projects. Moving a Project requires management of the Project and update permission on its source/destination workspace; workspace editors therefore qualify when they also manage the Project. An archived workspace accepts no new assignments. Existing attached resources remain accessible under current grants and may be moved out. Workspace names and lifecycle state use version checks. Parent and owner references use tenant-composite foreign keys.

Project DTOs expose only declared fields. Updates require the expected version; stale edits return a conflict. Soft deletion releases one capacity unit, and restore must reserve it again. Every nondeleted Project counts, including Projects whose status is completed or archived; status changes do not bypass capacity. Deleted slugs remain reserved. The registry and grants retain tombstones for authorized restoration.

Create, delete and restore commands use actor/tenant/operation-scoped idempotency keys and request hashes. A retry rechecks current authorization before returning its resource. Generic reservations distinguish missing, disabled, zero, limited and unlimited policy; reservation/settlement/release/expiry is transactional and idempotent. Missing or disabled Project policy blocks positive writes, including edits, moves and positive grants. Reads, deletion, grant revocation and explicit denial remain available for access and cleanup. A zero capacity is distinct from a disabled feature. A failed create or restore cannot leave a capacity charge or audit event behind.

Lists search allowlisted Project fields, scan indexed tenant candidates in stable creation-time/ID order, and batch-check access. Each call scans at most 40 candidates in batches of at most 20. A partial or empty page may have a continuation. The authenticated encrypted cursor contains the last scanned position, full timestamp precision, expiry, actor, tenant and query binding. Clients continue it until exhausted; responses expose neither unrestricted totals nor rejected counts.

## Service principals

Human administrators with fresh authentication provision accounts, issue keys, rotate/revoke keys, and deactivate accounts through declared API procedures. Secrets are generated with cryptographic randomness and returned once; only their SHA-256 hashes and display prefixes are stored. Idempotent secret-issuance retries cannot retrieve a previously issued secret. Rotation revokes the old key in the same transaction that creates its replacement.

Organization create/list capabilities are explicit on the service account. Key scopes intersect current account capabilities and explicit resource grants; keys cannot inherit human organization-administrator roles. Every protected operation reloads the current key/account, tenant, expiry and independent recovery epoch under the organization fence. Existing identity, tenancy and human/team-sharing procedures reject service principals unless the procedure explicitly declares support. The key-management API is available in Foundation; customer key-management UI remains Phase 6.

Use both create and read scopes for a retryable create-and-read workflow. A create-only key may submit a new resource and receive its submitted data, but a replay returns the current resource DTO and therefore also requires its current read scope and resource grant. Without those, replay fails closed rather than exposing content changed since creation.

Audit and outbox records commit with domain changes and contain bounded identifiers/version metadata rather than resource content or credentials. These are durable events for downstream consumers. Project activity feeds, customer notifications, billing providers and cross-resource search remain the later modules scheduled in the roadmap; this phase does not claim those interfaces exist.

## Verification commands

```sh
bun run check
bun run typecheck
bun run knip
bun run test:unit
bun run test:integration
bun run authz:validate
bun run build
bun run test:e2e
bun run storybook:build
bun run authz:smoke
bun run authz:benchmark
```

The smoke command uses the full 100-tenant/1,000-membership/100,000-Project dataset and 50 concurrent clients but only a short measurement. It cannot satisfy `R-AUTHZ-PERF`. The full benchmark adds a one-minute warm-up and at least 30 measured minutes with no command retries. Half the resources belong to the hot tenant, which receives approximately 80% of traffic; the 60/20/10/10 workload includes sparse cursor traversal, ordinary edits, create/delete, sharing/revocation and parent moves.

Twenty-five clients use RPC and twenty-five use REST through the actual in-process handlers, with real signed Better Auth sessions, Zod validation, DTO serialization and the normal runtime's restricted database pools. Request timings include pool queueing and all authorization work. They exclude external TCP and the Next.js route wrapper, which the separate browser suite exercises. Reports retain source fingerprints, versions, container limits, database/WAL growth, graph tuple counts, first-attempt outcomes, latency, fence waits, source readiness and create-to-readable timing under `artifacts/phase3/`. A run interrupted by a signal leaves a partial report and cannot pass the gate.

Workload counts and throughput use client operations: create includes its first authorized read, and revoke includes a subsequent denied read. The write latency therefore includes those extra calls, and deliberate revocation denials are counted separately. The dedicated create-to-readable and revocation metrics cover the complete corresponding workflow. There are no retries or permission caches in the measured path.

Prevent host sleep during the full run (on macOS, use `caffeinate -i bun run authz:benchmark`). The harness rejects a long event-loop pause instead of treating suspended wall time as sustained load. A client starts a fresh list query when its saved cursor has been idle for five minutes, before the server's 15-minute cursor expiry; active sparse scans continue normally. This is planned cursor lifecycle handling, not a retry of a failed operation.
