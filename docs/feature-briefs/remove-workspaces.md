# Projects directly under Organizations

## Product and access decision

The optional Workspace domain is retired. Each existing Project keeps its Organization, ID, slug, name, description, status, owner, version, timestamps and deletion state. Teams and direct Project sharing remain supported. There is no replacement grouping resource, assignment operation or feature flag. Strict API inputs reject `workspaceId`; removed Workspace endpoints, `project:move` and `workspace:*` permission scopes are unsupported.

The user explicitly chose on 2026-09-27: **retire inherited Workspace access; document the loss and require explicit Project sharing afterward**. The migration therefore removes Workspace grants without copying them to Projects or Organizations. People, teams and service accounts whose only access came from a Workspace lose that access, including for archived Workspaces and soft-deleted Projects. Organization owners/admins retain their existing content administration; direct Project grants and denies retain their IDs, subjects, relations and expiries. An archived Workspace never implied loss of inherited access previously, so it is included in the impact review.

A Workspace deny previously suppressed only the inherited path; direct Project access could still authorize independently. Retiring the entire inherited path and its allows/denies preserves that direct policy without accidentally turning Workspace denies into Project denies. No grants are broadened. Administrators must explicitly review and share individual Projects after deployment if continued access is intended. The migration does not infer that a prior inherited relationship should become a permanent direct grant.

## Database and historical data

Append `0007_organization_projects` using the pinned Drizzle workflow; retain migrations `0000`–`0006` and their snapshots unchanged. The reviewed migration appends bounded per-Organization cleanup counts to audit/outbox, then cleans dependent command/capacity/grant data, then drops the obsolete Project and registry relationships and Workspace table. Project records, direct grants, unrelated generic capacity records, and audit/outbox history are preserved. Remove obsolete service-account capabilities and API-key scopes without converting them to broader rights; a key with no remaining scope cannot authorize a request. Current issuance and authentication reject unsupported scope vocabulary.

Obsolete Workspace command receipts and assignment/move receipts are no longer replayable. All predecessor Project creates hashed the removed field (including `workspaceId: null` for unassigned Projects). Their saved receipts remain intact, but a create replay under the new contract conflicts; it cannot create a duplicate. Clients must use current Project reads to reconcile pre-deployment requests and must stop sending the removed field. New-contract retries retain normal idempotency. Existing audit/outbox JSON is retained verbatim as historical evidence, including retired event kinds and identifiers. It is not an active authorization source and does not resurrect a removed resource. Consumers must treat those payloads as historical events and must not assume a live Workspace lookup is available.

## Publication and deployment order

1. Validate the existing installation binding/readiness; finish any interrupted predecessor model upgrade with its matching release before beginning this schema cleanup. Recovery-required or divergent-source installations must follow the established recovery protocol. Inventory affected Workspace-only access and any integrations using removed routes/fields/scopes. Record intended explicit Project sharing; do not blanket-convert into Organization grants. Back up the application and independent control stores using the established recovery policy.
2. Drain all old web/worker processes and keep tenant traffic stopped for the maintenance window. Old and new binaries must not run concurrently across this breaking schema/API/model upgrade.
3. With the new release and migration-only credentials, run `bun run db:migrate`. The SQL cleanup is transactional and journaled; failed execution rolls back, and successful replay does not repeat cleanup. No production migration is performed by this development task.
4. With the dedicated control administrator, run `bun run authz:upgrade`, then `bun run authz:publish`. The successor explicitly recognizes immutable Phase 2 and Phase 3 predecessor hashes. Historical completed upgrade receipts are preserved; receipts are keyed by installation and destination model so a second supported upgrade is possible. Retry an interrupted upgrade on the same installation. Never bootstrap populated data, clear recovery state, or reset readiness/epochs to force compatibility.
5. Start the new runtime, verify tenant/direct Project access and obsolete API rejection, and explicitly share reviewed Projects with affected principals. Publish regenerated clients/OpenAPI and remove obsolete deployment configuration. The schema drop is irreversible by rolling back binaries; restore requires the existing coordinated recovery protocol, never an ad hoc readiness reset.

Fresh installations apply the full migration journal and run `bootstrap`; they never expose Workspace resources. Upgrade fixtures must cover populated, archived and empty Workspaces, assigned/unassigned and soft-deleted Projects, direct and inherited grants/denies, teams, API keys, capacity, receipts and unchanged event history. Source revisions advance with cleanup; lifecycle fence ordering and the final database-time authorization guard remain authoritative.

## Performance and retained references

The benchmark now measures `direct-project-v1`: the same 100 tenants, 1,000 memberships, 100,000 Projects, 50 clients and 60/20/10/10 mix, with direct sharing/revocation replacing parent moves. Every share verifies a recipient read and every revoke verifies denial. `authorizationChanges.valid` reconciles confirmations with successful commands and rejects warm-up failures. Latency/availability targets remain unchanged. A short smoke cannot satisfy the 30-minute performance gate; predecessor reports cannot verify this model.

Intentional retained domain references are limited to:

- Applied SQL/snapshots, immutable Phase 3 model fixture and predecessor upgrade/preservation/rejection tests.
- Frozen `spikes/phase0` and `docs/phase0`, published Phase 1/2 evidence and historical Phase 3/4 acceptance records, including the historical dashboard redesign brief. Their results are not successor verification.
- This removal policy, migration guidance and roadmap retirement notices. Historical event payloads retain their original vocabulary.
- Evaluator-owned `evaluations/phase4` expectations/baseline hashes and existing evaluation requirement metadata. They are not rewritten to make this task pass; a new independently reviewed live-agent evaluation is separate work.

Bun workspaces, `workspace:*` dependencies, package/task workspace configuration, and references to a development checkout are unrelated terminology and remain unchanged.

## Verification record

Executed on 2026-09-27 with Node 24.19.0 and Bun 1.4.2, against isolated disposable services. No production database was migrated.

| Check | Result |
| --- | --- |
| `bun run check`, `bun run typecheck`, `bun run knip`, `git diff --check` | Passed on final source |
| `bun run test:unit` | 127 tests passed |
| `bun run test:integration` | Full run: 134 tests passed; subsequent added regressions are included in the final boundary gate below |
| `bun run skills:check --static` and `bun run skills:check` | Passed; final real-service boundary subset: 98 tests, including all 7 migration tests, 18 Project service tests and the added predecessor-access regression |
| `bun run authz:validate` | Passed: 28 policy cases and 4 contextual assertions against real OpenFGA |
| `bun run build`, `bun run storybook:build` | Passed |
| `bun run test:e2e` | All 32 Chromium tests passed, including EN/ES, light/dark, desktop/mobile, CRUD/retry/tenant-denial and obsolete-request cases |
| `bun run authz:smoke` | Passed: 3,923/3,923 operations over 15.226 measured seconds; 232 verified shares, 164 denied reads after revocation, zero warm-up failures; source stable |
| Full performance gate | Not run during removal verification; subsequent manual run on 2026-09-27 passed, as recorded below |
| Image rebuild/acceptance/security scans, live-agent evaluation | Not run; no claim of those gates passing |

The smoke report is `artifacts/phase3/authorization-smoke-2026-09-27T00-39-47-551Z.json`, workload `direct-project-v1`, source fingerprint `d8c8181967c7aec7c1a6d24c55df7720c9d8b1e69c488251ae42db375d652c69` on base `78c086b259a515da3524d914773f6c56c40d9311` plus this working tree. Final skill evidence is `artifacts/phase4/checks/1790469437098-2aaa3ee4-6122-473e-9854-f7d2248c383d/report.json`. Other logs are under `artifacts/workspace-removal/`; `reference-audit.json` classifies retained case-insensitive/domain/localized matches. Visual inspection confirmed the Project list at English/light desktop and Spanish/dark mobile widths.

Initial checks exposed formatting differences, a strict-service/API tenant-field forwarding mismatch, and synthetic upgrade-fixture SQL casts/policy setup; each was repaired and the affected checks rerun. First browser failures and the initial skill-boundary failure remain in diagnostic artifacts. Automatic approval review initially misapplied the historical Phase 4 benchmark exclusion; after inspection of the actual request/AGENTS.md and disposable fixture, reconsideration approved the same smoke command. No approval or implementation blocker remains. The full 30-minute `R-AUTHZ-PERF` gate was pending at the end of removal verification; no predecessor result was reused as successor acceptance.

## Subsequent full performance acceptance

The manual `direct-project-v1` run `2026-09-27T11-03-09-677Z` passed on 2026-09-27 with **524,149/524,149 successful operations**, **1,800.678 measured seconds**, **50 clients**, zero retries and all latency targets met. It verified **27,238 share/read confirmations** and **25,163 revocation denials**, with zero warm-up failures. The stable implementation fingerprint is `8482f8022253a68f509ba05ed302443a5ff552ca079dc80cdd109310f6c1112c`. See the [Phase 3 acceptance record and complete report](../phase3/acceptance.md#accepted-direct-project-performance-result) for source provenance, scope, latency and storage measurements. This closes the successor's real-feature performance gate; it does not refresh image/security or live-agent evaluation evidence.
