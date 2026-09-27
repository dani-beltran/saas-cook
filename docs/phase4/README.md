# Phase 4: AI agent skills

Six portable repository-local skills guide bootstrap, new features, evolution,
dashboard views, transactional email and verification. Invoke a skill explicitly
by name or use the [manual discovery adapter](../development/agent-skills.md).
The instructions operate on ordinary source; no generator, regeneration manifest
or runtime customer-prompt execution is introduced.

Read the [source map](../development/feature-workflow.md),
[module inventory](../development/module-availability.md), and relevant
[feature briefs](../../feature-briefs/phase4-project-task.md). Foundation uses
real local entitlements, capacity, sessions, service accounts and contextual
OpenFGA without commercial credentials.

## Deterministic verification

```sh
bun run skills:check --static
bun run skills:check --static --base <review-base-commit>
bun run services:up
bun run skills:check
```

Static checks validate skill discovery/references, ordered migration metadata
and immutable prior SQL/snapshots, executable DTO/input allowlists and explicit
route principal capabilities. Source CI compares migration history with the
actual PR/push base. Structural checks supplement runtime tests; they do not
prove every service policy is correct.

The full command also runs negative controls and real-service DB/API/authz
regressions. PostgreSQL catalogue discovery finds tenant tables rather than
relying on a fixed list. Restricted web/worker roles exercise cloned policies
with two synthetic tenants; actual migrations/services separately test their
real constraints and data. Missing RLS, permissive policy, cross-tenant FK,
DTO and permission defects must produce failures. Missing services fail the
command. Reports and failure logs live in `artifacts/phase4/checks/`.

## Behavior evaluation

The [evaluation guide](evaluation.md) describes the separate prepare, author,
record, run and summary workflow. The checked-in suite is
[`evaluations/phase4`](../../evaluations/phase4/README.md); two independent
candidate applications cover all ten roadmap tasks. Candidate source and
customizations are isolated from the evaluator's expected behavior and baseline.
Real AI transcripts, source diffs, versions, named cases and application checks
are required. Missing/failed cases, altered expectations and stale source
invalidate acceptance. Standard CI never invokes a paid AI service.

The Task exercise inherits its immutable Project parent's current permissions;
it uses the existing pinned model and scoped key boundary. It does not introduce
independent Task grants or a second graph protocol. Evolution exercises preserve
custom code and existing rows across additive/backfill/rename steps. The Task,
renamed product, directory page and new email are disposable evaluation outputs,
not additions to the production reference application's domain.

See the [acceptance record](acceptance.md) for results and limitations. The user
explicitly excluded the then-missing Phase 3 performance run from that evaluation.
Phase 4 tooling never invokes it. The separate [manual 2026-09-27 run](../phase3/acceptance.md#accepted-direct-project-performance-result)
now passes the real-feature `R-AUTHZ-PERF` gate; Phase 4 checks do not establish
performance acceptance or the remaining Foundation release sign-off.
