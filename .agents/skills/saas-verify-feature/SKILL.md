---
name: saas-verify-feature
description: Review and validate a SaaS feature using deterministic checks and real behavioral evidence across data, permissions, API and UI. Use to diagnose incomplete integration or verify a completed change.
---

# Verify a feature

Read [AGENTS.md](../../../AGENTS.md), the brief, source diff and [verification guide](../../../docs/development/verification.md). Compare requested behavior with [module availability](../../../docs/development/module-availability.md). Identify applicable stable requirement IDs in the [roadmap](../../../docs/06-delivery-roadmap.md#capability-to-phase-and-acceptance-matrix).

Inspect schema/journal/snapshot, tenant RLS/grants/composite FKs, strict DTOs, current authorization, explicit endpoint principal capabilities, capacity/idempotency/version checks, audit/outbox and client states. Follow canonical [authorization](../../../docs/02-architecture-and-security.md#26-relationship-based-authorization), [lock order](../../../docs/03-data-model.md#canonical-lifecycle-lock-order) and [recovery](../../../docs/04-billing-usage-operations.md#recovery-readiness-protocol) contracts rather than inventing abbreviated procedures.

Exercise meaningful allow/deny and failure paths with real PostgreSQL/OpenFGA and restricted roles. Verify cross-tenant references in both services and SQL, hidden/server fields, sparse/malformed cursors, stale versions, revoked/expired/wrong-tenant keys and undeclared endpoints. Include capacity races/replays and late-response/connection-loss/expiry cases where applicable, especially expiry accumulated across all authorization batches. Use fresh and predecessor-upgrade data for migration changes.

Keep evaluator-owned expectations and regressions outside the implementation agent's editable output. Seeded missing RLS, permissive DTO or absent permission calls must yield behavioral failures. Never weaken assertions, exclude failing cases or skip missing services to obtain green results. Fix within the ongoing implementation task or when requested; a review-only request should return findings without unrelated changes.

Record exact commands/outcomes, template commit plus dirty-source fingerprint/diff, skill/reference versions, brief and actual agent/model configuration. Distinguish application checks from live-agent behavior evaluations; retain every declared repeat, including failures. Ordinary CI needs no live AI service. A failed required evaluation blocks skill release until corrected and rerun; one successful run proves no universal reliability. Re-evaluate affected tasks after guidance/contracts/model changes.

Return findings with source locations, reproduced behavior and impact, then passed checks and precise gaps. UI polish and typecheck alone cannot establish acceptance. Honor task exclusions: this Phase 4 execution does not run the missing Phase 3 benchmark or label that gate passed.
