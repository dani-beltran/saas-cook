# Independent Phase 5 authoring evaluation

This is the explicit five-task Commercial extension of the Phase 4 controller.
`heldout/manifest.json` declares `phase: 5`; omitting that field retains the
unchanged ten-task Phase 4 contract. `PHASE4_RESULT` is the controller's stable
wire format, not a claim that this is a Phase 4 evaluation.

The public briefs specify the candidate extension contracts. The held-out tests
import those candidate modules, actual canonical services and restricted-role
PostgreSQL/OpenFGA fixtures. Expectations, baseline test identities, immutable
migration/source hashes and the review-fixture hashes remain controller-owned.
Targeted Vitest selection excludes other task names; every selected required case
must pass and final acceptance requires all declared tasks in both candidates.

| Task | Independent assertions |
| --- | --- |
| 01 | Sold v1 definition/subscription/allowance survives v2; append-only replay; restricted-role denial; strict input; environment-scoped mappings; customization preservation |
| 02 | Real template creation, tenant/current authorization, strict input, scoped replay, conflicting replay and final-unit race; rollback, repeated release, reservation expiry, correction, rebuild, original-window replay, next-window bucket and final transaction expiry |
| 03 | Confirmed downgrade shape, admission denial, exact-once deactivation, current authority, cross-tenant denial, last-owner protection, reactivation and local override denial |
| 04 | Both localized threshold email representations; durable dedupe, rollback, encryption, retry, recipient revocation and purge; real browser copy/customization/keyboard/denied state plus intercepted pending/outage/conflict presentation |
| 05 | Each seeded failure is observed against real SQL/canonical services, then the candidate's actionable diagnosis is required |

The rollover case moves a retained bucket into a predecessor window and then
creates a current-window bucket. It does not claim that the PostgreSQL system
clock was advanced. Local synthetic provider adapters exercise local integration
policy; they do not count as real Stripe or hosted Checkout evidence. SMTP and
ordinary billing regression tests run independently in the full integration set.

Before agent dispatch, retain an original source snapshot with
`CUSTOM-BILLING-NOTES.md`, the public briefs, the exact `review-billing/` seed and
the rendered support-footer customization. Use `skills:evaluate prepare` with
this heldout/brief directory, `--baseline` pointing to that original snapshot and
`--repeat 2`. Adopt externally dispatched candidates with the normal controller.
Preserve actual interruption checkpoints, resumed prompts and source-identical
repeat snapshots outside each candidate. Build each final candidate before
running the evaluator because its task 04 browser uses the production output.

Ordinary application checks protect original suite identities, test sources,
installation/authorization fixture helpers, command/configuration files and
applied migrations. Added cases must also pass. Source, Knip, type checks, unit,
full integration and production build are distinct from held-out authoring cases.
No synthetic transcript, controller unit test, missing service, skipped required
case or local fake provider establishes live-agent/provider acceptance.

The canonical evaluator directory also includes `dashboard-helpers.ts`, an exact
copy of the original browser helper, so static repository tooling can resolve the
spec's import. The executable wrapper stages the hash-protected candidate helper
at check time. The original 2026-10-19 control snapshot predates this static copy;
its own frozen control hashes remain authoritative for that retained attempt.

The first controller run exposed a browser setup defect: setting
`PLAYWRIGHT_BASE_URL` to an empty string overrode the candidate's default origin
and failed before any browser assertion ran. The corrected `release-v2` removes
that assignment and includes the static helper copy. Its initial source, task
requirements, assertion sources, test identities and protected hashes are identical
to the original. The original failure and exact wrapper diff are retained; both
candidates run the complete declared checks under the corrected frozen controls.

## Controller reproduction

Run from the repository root with the pinned toolchain and disposable services.
The paths below are examples; preparation requires a previously nonexistent output.

```sh
bun run skills:evaluate prepare --output /private/tmp/phase5-release \
  --evaluators evaluations/phase5/heldout --briefs evaluations/phase5/briefs \
  --baseline /private/tmp/phase5-original-source --repeat 2
bun run skills:evaluate adopt --output /private/tmp/phase5-release \
  --repeat 1 --candidate /private/tmp/phase5-author-1/candidate
bun run skills:evaluate record --output /private/tmp/phase5-release \
  --repeat 1 --evidence /private/tmp/phase5-author-1-evidence.json
bun run skills:evaluate run --output /private/tmp/phase5-release --repeat 1
bun run skills:evaluate summary --output /private/tmp/phase5-release
```

Record/adopt/run the independent second candidate with `--repeat 2` as well.
Use the real host transcript and metadata evidence schema from
[the controller guide](../../docs/phase4/evaluation.md); its taskIds must be
`phase5-task-01` through `phase5-task-05`. Local service access may require host
sandbox escalation; a denied connection remains a failed check until rerun with
actual service access. Never replace a denied connection with an unconditional
case marker.

The controller hashes control files before and after every command; source is
snapshotted and compared across the complete run, failed attempts are retained,
and summary checks transcripts, logs, source and required task/application results.
These checks detect accidental changes; filesystem separation alone does not
isolate an unrestricted authoring agent. The host must restrict authors to their
candidate, and reviewers must assess transcript provenance and the retained
interruption/repeat/provider supplements separately. A passing harness summary
cannot authenticate a model identity or prove real provider acceptance.

## Real Stripe API supplement

`live-provider.ts` is a supplementary evaluator outside the frozen local controls.
It imports the selected candidate's real services/adapters and its installed
Stripe SDK. It requires an explicit `sk_test_` key, creates a real Stripe test
clock/product/two monthly prices/customer/paid subscription, then exercises sold
plan preservation, actual downgrade/admission races, the candidate seat/template
operations, quota replay/racing and a real v2 subscription-price switch. It also
checks the adapter's real account-validation denial. No provider method is faked.

From the template root, after each candidate's authors have stopped editing:

```sh
node --env-file=.env --import tsx evaluations/phase5/live-provider.ts \
  --candidate /private/tmp/phase5-author-1/candidate \
  --report /private/tmp/phase5-release/run-1/stripe-api-supplement.json
```

Run independently for candidate 2 and retain every failed report and rerun. The
program records source hashes before/after, named checks, sanitized failure stage
and error type, synthetic resource identifiers and cleanup outcomes. It cancels
its subscription, deletes its customer/test clock, deactivates both prices and
product, and deletes the disposable local installation. Cleanup/source changes
also fail the supplement. Credentials and provider payloads are not retained.

This supplement does not complete hosted Checkout, receive a webhook, use the
Customer Portal, simulate a provider outage or advance the Stripe test clock.
The mapping to the synthetic tenant is explicit migrator-owned setup. It supports
the applicable live-provider evidence; the separate hosted Checkout and webhook
acceptance records remain necessary for their claimed coverage.
