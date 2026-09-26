# Feature verification and skill evidence

Use the stable IDs in the [roadmap matrix](../06-delivery-roadmap.md#capability-to-phase-and-acceptance-matrix) and [skill evaluation requirements](../05-ai-agent-skills.md#57-skill-evaluation-and-release-evidence). Static checks validate structure; real restricted-role and API behavior establish security and feature acceptance. Neither screenshots nor successful compilation substitute for those cases.

## Executable repository checks

Run from the repository root with pinned Bun/Node. Select tests proportionally to changed behavior; run the required release set before claiming a milestone. Keep failures and build/report evidence under ignored `artifacts/`.

| Change/check | Actual command and scope |
| --- | --- |
| Source/format, strict types, unused code | `bun run check`, `bun run typecheck`, `bun run knip` |
| Unit behavior | `bun run test:unit`; a focused example is `bun run test:unit packages/api/src/resources.test.ts` |
| Real-service integration | `bun run services:up`, then `bun run test:integration`; missing services fail, never skip |
| Schema, role separation and upgrades | `bun run db:test:upgrade`; extend fixtures for the new preceding schema and old rows |
| Selected authorization model | `bun run authz:validate`; does not replace live fault/parity suites |
| Browser journeys | `bun run build`, then `bun run test:e2e` |
| Component states | `bun run storybook:build` |
| Production build/image | `bun run build`; when image acceptance applies, `bun run image:build` then `bun run test:image` |
| Historical boundary changes | `bun run phase0:test`; use its separate integration command for affected Phase 0 behavior |

Database generation is the pinned Drizzle command in [migration instructions](../../packages/db/migrations/README.md), followed by reviewed SQL. `db:generate` and `db:seed` are not root commands. Keep Knip entries exact and new code under Biome; do not weaken either tool to hide feature work. Ordinary application CI must run without a live AI service.

## Behavioral coverage map

| Boundary | Existing evidence to extend when affected |
| --- | --- |
| Tenant constraints, forced RLS, runtime roles, fresh/predecessor migrations | [migrations.integration.test.ts](../../packages/db/src/migrations.integration.test.ts), [tenancy.integration.test.ts](../../packages/db/src/tenancy.integration.test.ts) |
| Capacity, scoped replay, versions, disabled policy, DTOs/events | [resources.integration.test.ts](../../packages/db/src/resources.integration.test.ts) |
| Contextual policy, inheritance, revocation, outages and late responses | [resources.integration.test.ts](../../packages/authz/src/resources.integration.test.ts), [authorization.integration.test.ts](../../packages/authz/src/authorization.integration.test.ts), [parity.integration.test.ts](../../packages/authz/src/parity.integration.test.ts) |
| Key/account/scope and expiry through commit | [keys.integration.test.ts](../../packages/authz/src/keys.integration.test.ts), [key-expiry.integration.test.ts](../../packages/authz/src/key-expiry.integration.test.ts), [session-expiry.integration.test.ts](../../packages/authz/src/session-expiry.integration.test.ts) |
| RPC/REST validation, principal capabilities, output and error mapping | [resources.test.ts](../../packages/api/src/resources.test.ts), [resources.integration.test.ts](../../packages/api/src/resources.integration.test.ts) |
| Identity/assurance and email safety | [identity.integration.test.ts](../../packages/auth/src/identity.integration.test.ts), [password.integration.test.ts](../../packages/auth/src/password.integration.test.ts), [email workflow](email-workflow.md) |
| Localized browser behavior and keyboard states | [identity.spec.ts](../../tests/e2e/identity.spec.ts), [foundation.spec.ts](../../tests/e2e/foundation.spec.ts) |

For each new tenant feature, prove wrong/missing context, overlapping users across organizations, same-tenant relation enforcement in services and SQL, viewer/editor/admin/revoked behavior, and explicit supported/unsupported service principals. Assert field exposure independently for writes, reads, lists, relation pickers, events and logs. Exercise forged/query-mismatched cursors, stable bounded pagination, idempotent creates, stale versions and races for the final capacity unit. Preserve transaction-wide expiry after the last SQL and across earlier authorization batches.

Upgrade fixtures retain existing data, audit history and custom behavior. A fresh database alone cannot establish compatibility. Fault tests must deny late authorization after connection loss and obsolete namespace/model/epoch context, and must preserve the shared recovery boundary. Apply the canonical contracts linked from [feature workflow](feature-workflow.md) when expanding cases.

## Isolated live-agent evaluation

Keep author input, candidate source and evaluator-owned expectations separate. The evaluator retains the regression/held-out tests and baseline migration/model hashes outside the agent's editable output. Prepare an isolated checkout/copy with synthetic fixtures and dedicated local databases; do not use a production database or customer text as instructions. A supplied task brief defines the feature, not the expected implementation. Require retained source diffs and real execution, not a narrative claim that a skill was used.

Declare tasks and repeat count before evaluating. Record every attempt, including author failures, failed checks, repairs and reruns. A repeated unchanged request is a distinct preservation case; verify no duplicate migrations/registrations/events or overwritten custom files. For interruption, preserve the partial diff and data, then resume from actual state. Do not let the author edit the evaluator-owned expectations to achieve success. Verify seeded missing RLS, DTO and permission integration by observable failures.

Evidence records template commit, dirty-source fingerprint/diff, skill/reference content versions, task brief/version, actual agent/model/configuration, isolation setup, executed commands/status, case-level findings and repeat identity. Report unknown model metadata as unknown rather than infer it. Store diagnostics in `artifacts/` and commit a concise acceptance record with source/evidence fingerprints. A failed required case blocks release until repaired and rerun; skipped/missing modules remain gaps. Re-evaluate affected tasks after guidance, shared contracts or supported agent/model changes. A deterministic evaluator may reproduce a candidate and verify behavior; it must not claim to be a live-agent run unless an agent actually authored that candidate.

The current Phase 4 request explicitly excludes the missing Phase 3 benchmark. Do not run `authz:smoke` or `authz:benchmark` as a substitute or report `R-AUTHZ-PERF` passed. Track that external prerequisite separately from Phase 4 outcomes.
