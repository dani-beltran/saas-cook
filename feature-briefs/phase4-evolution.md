# Customized Task evolution and resume evaluation brief

Use `saas-evolve-feature` on a completed [child Task candidate](phase4-project-task.md), with existing rows and an evaluator-provided customized UI/service rule. Record and preserve those customizations and an unrelated dirty file. The evaluator retains baseline SQL/model hashes and behavioral assertions outside author output. These are independent evaluation scenarios; do not silently combine an incompatible destructive request with the additive scenario.

## Additive and required data

Add optional `dueDate` as a nullable ISO calendar date with explicit input/output handling and localized UI. Add required `priority` in `low | normal | high`, preserving existing Task data. Expand with a compatible nullable/default representation, backfill existing rows deterministically to `normal`, then enforce the constraint. Define a bounded resumable backfill and show interruption/replay leaves the same rows and no extra semantic user events. Keep old API callers compatible by defaulting omitted priority to `normal`. Validate invalid dates/enum values and unauthorized writes; hidden fields stay hidden.

## Explicit rename and permission change

In a separately declared repeat, rename the public `title` field to `summary` with a one-version compatibility window: accept either name, reject contradictory simultaneous values, return both as the same value during the window, and preserve existing database content. A compatible source/API mapping may retain the physical column until an explicitly scheduled contract step. Do not drop the old column or rewrite historical migration files to obtain the new name.

Change Task completion transitions (`completed` toggles) to require the parent Project's `manage` permission; ordinary text edits continue to require `update`. For bearer principals the transition also requires the explicit `project:manage` scope and current resource grant; text updates retain `project:update`. If a request changes both fields, both applicable requirements must hold. Get/list remain parent `read`. Test current viewer/editor/manager and service-key scopes, parent revocation, stale versions and deadline changes. No independent Task grant graph is introduced.

## Preservation, interruption and repeat

Before editing, identify evaluator-supplied custom validation and UI behavior. Keep it running after migration/evolution; adapting its call site is acceptable, deleting it is not. Compare old row IDs/content, audit history and migration/model files before/after. Retain the supplied unrelated working-tree edit.

Stop the author after a partial implementation is recorded, then ask a fresh context to finish the same request with the partial diff, database journal and earlier evidence available. It must inspect state and resume missing work, not repeat initialization or copy an old feature over current source. Repeat the completed request once more: no new migrations, duplicate route/locale registrations, duplicate backfill effects or overwritten customization.

An ambiguous request such as “remove the old customer text” must produce a precise unresolved deletion/retention question with independent safe work completed; it must not cause an inferred destructive migration. Record this as correctly unresolved product intent, not as completed deletion.

Acceptance covers `R-SKILLS`, `R-TENANCY`, `R-LIFECYCLE`, `R-AUTHZ`, `R-KEYS`, `R-POLICY`. Run real fresh/upgrade data checks, API/UI behavior and held-out preservation assertions for each declared repeat. Record limitations and failed attempts. No production migration or backfill is authorized.
