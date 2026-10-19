# Phase 5 skill evaluation status

The five authoring/verification skills were applied to the implementation, and their
source/migration/RLS/DTO/principal checks were run. This is distinct from independent
live-agent behavior acceptance under [skills §5.8](../05-ai-agent-skills.md#58-module-dependent-acceptance).
Historical Phase 4 candidate transcripts do not cover the new billing/usage boundaries.

Two fresh isolated candidate runs are required, with evaluator-owned starting migration
hashes, customizations and hidden expectations outside candidate edits. Each run must use
the actual repository-local skills and cover:

1. Evolve a sold-plan feature without rewriting its version or predecessor migrations;
   retain an unrelated customization and prove tenant/provider mapping isolation.
2. Add a permitted operation consuming the versioned quota helper; prove retry, rollback,
   expiry, correction, rebuild and final-unit race behavior across a window boundary.
3. Evolve seat-related behavior without bypassing canonical fences, current authority,
   external downgrade truth or repeat deactivation.
4. Add a localized dashboard/email behavior over the actual service, including denied,
   pending, conflict and outage states; prove durable deduplication and recipient recheck.
5. Diagnose and reject seeded permission, DTO, RLS, provider-trust and quota regressions.

Use two independent coding agents and preserve their original prompts, tool transcripts,
exposed model/configuration, source fingerprints, every failed repeat, held-out results
and resulting ordinary application checks. The Phase 4 runner's fixed ten-task manifest
must not be presented as a Phase 5 evaluation without extending its declared task coverage.
No synthetic transcript, local fake provider, skipped check or bookkeeping unit test counts.

## Current acceptance — 2026-10-19

**Phase 5 `R-SKILLS` passes the declared two-candidate evaluation.** The
[versioned evidence index](evaluation-2026-10-19.json) records the actual prompts,
host transcripts, exposed model/settings, source fingerprints, frozen controls,
failed attempts and final results. Both independent authors used the actual
candidate-local skills on `gpt-6.1-sol` with the exposed `ultra` reasoning setting.
This demonstrates these bounded tasks and configuration, not universal reliability.

Both candidates began from commit `7ebc9c46aae30c18ea03e5d2568f51f0bb4cf77e`, with an
externally retained 467-file source snapshot, public briefs, a deliberate unsafe review
fixture and an unrelated rendered billing-support customization. All 111 protected
migration, configuration, fixture and original test hashes remain identical in both.
The explicit [Phase 5 evaluator](../../evaluations/phase5/README.md) declares five
`phase5-task-*` tasks; the original Phase 4 ten-task contract remains unchanged.

| Final evidence | Candidate 1 | Candidate 2 |
| --- | --- | --- |
| Declared authoring/review tasks | 5/5 | 5/5 |
| Independent integration/browser assertions | 7 + 1 passed | 7 + 1 passed |
| Complete candidate unit cases | 138 passed | 138 passed |
| Complete candidate real-service integration cases | 191 passed | 189 passed |
| Source, types, Knip and production build | Passed | Passed |
| Actual Stripe test-API supplement | 7/7; cleanup passed | 7/7; cleanup passed |
| Completed-request repeat | 479 source files unchanged | 479 source files unchanged |

The controller preserves a planned partial-work stop after tasks 01/02 and an explicit
same-agent resume. A retained real Project, its single usage event and all 11 migration
records survived; replay created no duplicate. This is not a forced process-crash test.
Window rollover uses a retained predecessor bucket and UTC boundary assertions, without
advancing PostgreSQL's clock. Ordinary application checks preserve 137 baseline unit and
169 baseline integration case identities and require added cases to pass as well.

Actual Stripe test-mode runs import each candidate's implementation and verify sold-plan
preservation, mapping isolation, provider-confirmed subscription changes, a downgrade racing
admission, repeated seat deactivation and the template quota race. These are separate from
synthetic provider fixtures. They do not complete hosted Checkout, webhook ingress, Portal,
provider-outage or external email-deliverability acceptance.

Initial author/test failures and a browser focus-retention failure remain in the evidence.
Candidate 1 repaired the inherited Refresh focus issue in its disposable copy; candidate 2
retains baseline behavior and passes the declared keyboard-activation contract. No candidate
implementation was promoted into the production application.

The first independent controller attempt failed before browser launch because its wrapper
supplied an empty base URL. The retained corrected `release-v2` changes that runtime setup
and includes an exact static helper copy; initial source, requirements and assertion hashes
are unchanged. Both candidates passed the complete required set under the corrected controls.

Diagnostics, actual host transcripts, source diffs and preserved attempts are retained under
ignored `artifacts/phase5-evaluation/2026-10-19`. Isolation uses separate source copies,
disposable databases, author instructions, control hashes and transcript review on a shared
host; it is not an OS-enforced security boundary. Calibration temporarily staged ignored
hidden copies inside candidate 1; the complete author tool-call audit found no access, the
copies were relocated, and canonical frozen controls always remained external.

**Phase 5 is completed and accepted for its documented scope as of 2026-10-19.**
These candidate trials retain their SDK 22.6.2 baseline and do not claim an independent
authoring repeat for the subsequent SDK 23.0.0 / Endive update. The final-source Endive
hosted Checkout repeat and current hosted CI/security gates subsequently passed, as recorded
in the [acceptance record](acceptance.md). That later evidence does not broaden the scope
of these historical candidate trials. M2 Commercial still requires Phase 6.
