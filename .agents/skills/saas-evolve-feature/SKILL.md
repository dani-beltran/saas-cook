---
name: saas-evolve-feature
description: Change an existing SaaS feature's fields, relationships, permissions or lifecycle while preserving custom code, data and history. Use for compatibility work and interrupted feature edits.
---

# Evolve the current feature

Read [AGENTS.md](../../../AGENTS.md), [feature workflow](../../../docs/development/feature-workflow.md), the current brief, affected source/tests and migration/model history. Inventory uncommitted customizations, consumers and deployed schema assumptions. Evolve the actual implementation; never reconstruct it from an old brief or overwrite it with the Project reference.

Write consequential compatibility decisions into the existing brief. The [evolution brief](../../../feature-briefs/phase4-evolution.md) supplies evaluation cases. Optional fields need additive schema/DTO/UI changes. Required fields on populated tables need an expand step, a defined resumable backfill and validation before enforcement. Explicit renames need source-to-destination mapping and an API compatibility window. Type/enum/precision changes need conversion and rejection cases. Do not infer a drop, tenant-scope rewrite, retention change or destructive rename from an ambiguous request; continue independent work while resolving that product decision.

For changed permissions/inheritance read the canonical [authorization protocol](../../../docs/02-architecture-and-security.md#26-relationship-based-authorization), [lock order](../../../docs/03-data-model.md#canonical-lifecycle-lock-order) and [recovery protocol](../../../docs/04-billing-usage-operations.md#recovery-readiness-protocol). Review compiler/model parity, source revision publication, independent readiness, expired/revoked grants and the transaction-wide expiry guard. Append a supported model-upgrade path when the model changes rather than rewriting a published release or resetting an installation. Reconcile deletion/restore changes with capacity, grants and retention. Keep service-principal scope changes explicit.

Generate/review migrations using the [actual Drizzle workflow](../../../packages/db/migrations/README.md). Test fresh initialization and upgrade from the preceding schema with representative old rows, audit records and custom behavior. Backfills must have restart/idempotency evidence; no production backfill is implied by this skill.

On interruption, inspect the source diff, schema journal, completed side-effect receipts and previous check output. Resume only missing work. Repeating an already-satisfied change should produce no unnecessary migration, route, locale key, subscription or event. Retain user edits and custom tests. A skill update alone is never a reason to rewrite an application.

Use [verification](../../../docs/development/verification.md) for changed behavior and regressions. Deliver the compatible source/SQL/access diff, executed evidence, backfill/deployment order, retained legacy surface and any unresolved destructive choice. Do not call missing dependencies or unrun tests successful.
