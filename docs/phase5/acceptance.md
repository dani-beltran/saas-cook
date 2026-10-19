# Phase 5 acceptance — updated 2026-10-19

**Phase 5 is not yet accepted.** Implementation and local verification are recorded below;
the final-source hosted Checkout repeat and hosted CI/security gates passed on 2026-10-19. Independent skill
behavior acceptance passed on 2026-10-19. **M2 Commercial is not accepted**: Phase 6 modules/recovery are still required.
The [roadmap](../06-delivery-roadmap.md) remains the canonical register.

Historical implementation baseline: clean `a35fa43a2cc32803750ffb8dae55adf655f3c283`, after accepted M1 Foundation.
At that checkpoint the work was uncommitted and preserved migrations 0000–0009. The additive 0010 migration has
been applied only to disposable test installations during this work. Actual source and
predecessor data were inspected; historical Foundation evidence is not used to pass changed paths.

## Implemented acceptance cases

| Area / requirement | Current evidence and limits |
| --- | --- |
| Plans/provider commands | Immutable sold versions and scoped price mappings; fixed/seat validation, current billing permission, previews, idempotent commands, outside-transaction provider calls, bounded retry/review and truth reconciliation. |
| Verified inbox | Raw signatures, invalid-signature rejection, durable acceptance before acknowledgement, duplicate/order/mapping isolation and quarantine. Actual signed Stripe CLI events were processed; no local fake counts as Stripe evidence. |
| `R-POLICY`, `R-SEATS` | Local/commercial intersection; pending/trial/active/grace/unpaid/cancellation/outage state tests; occupied-capacity checks, external downgrade/admission race, current eligible occupancy and repeated deactivation. |
| `R-TENANCY`, `R-LIFECYCLE`, `R-AUTHZ`, `R-KEYS` | Forced RLS and composite tenant relations, human billing authorization, billing-only content denial, bearer/cookie rejection, canonical locks and transaction-wide expiry. Full existing identity/resource/control suites rerun. |
| Usage/quotas | Actual Project create commit metric, operation deduplication, immutable corrections, rebuild watermark, final-unit races, release/expiry and period-boundary tests. Optional provider-rated metering remains disabled. |
| API/UI | Strict shared oRPC/Zod transport contracts and real RPC/REST parity; English/Spanish billing/usage routes, state/preview/effective/seats/invoice/reset/health views; real browser allow/deny and responsive/theme/contrast checks. |
| Notices / `R-EMAIL` extension | Encrypted durable lifecycle/threshold notices, rollback/deduplication, current recipient recheck, retry/expiry/purge, localized HTML/text and real disposable SMTP. External inbox delivery remains unverified. |
| Migration | Fresh fixtures and populated 0009 upgrade/replay; existing identity, memberships, Project, seats, audit/outbox and independent readiness preserved. No production migration execution is claimed. |
| Operations / `R-IMAGE` | Scoped catalogue/reconcile/diagnostics/rebuild commands; worker bounds, credential-free image builds and ten packaged command modes. Exact image evidence linked in the index. |
| `R-SKILLS` | **Passed 2026-10-19:** both independently authored candidates pass all five declared tasks, held-out/application checks, source-preserving repeats, retained data/resume and real Stripe test-API supplements. [Evidence and limits](evaluation.md). |
| `R-AUTHZ-PERF` | Renewed 30-minute run passed on unchanged Phase 5 source: 442,464/442,464 operations, zero retries; all original latency, current authorization and contextual graph targets met. Historical M1 numbers are not used to pass changed paths. |

## Executed verification and dated follow-ups

Unless dated separately, the implementation checks below record the 2026-09-27 evidence.

Diagnostics are retained under ignored `artifacts/phase5`; [evidence.json](evidence.json)
versions concise commands, provenance, hashes, results and limitations. Diagnostic report
paths are local evidence, not hosted CI run links.

- Bun 1.4.2 frozen install; Node 24.19.0 source/tool runtime.
- Biome source checks, strict TypeScript and Knip passed.
- **157 unit tests passed**, across 24 files.
- **173 real-service integration tests passed**, across 25 files, including the populated
  predecessor upgrade, actual worker connection loss, recipient revocation and retry exhaustion.
- Production and Storybook builds passed without Stripe credentials.
- **45 browser tests passed**, across 12 spec invocations. An additional expanded visual
  matrix passed for billing/usage in both locales, mobile/desktop, all palettes, light/dark,
  contrast and shell keyboard navigation. Representative screenshots were inspected.
- Full deterministic skill contracts passed; the final refreshed reference/real-service
  result is recorded in the evidence index.
- Non-root Linux arm64 image acceptance passed with Node 24.21.0 and Bun 1.4.2.
  Image help/missing-credential checks cover all ten commands; no additional architecture is claimed.
- Trivy 0.69.3 dependency and image high/critical policies passed with no exceptions added.
- Real Stripe sandbox runs passed hosted browser payment, paid seat lifecycle,
  upgrade/downgrade/renewal, delinquency/recovery, cancellation and signed webhook replay.
  An expanded 10-case API run also proved fixed-plan trial conversion and reconciliation
  after a lost response to a real paid upgrade, without another provider write or invoice.
  The hosted run processed 15 distinct real events; source fingerprints and the later
  final-source repeat status are recorded separately in the evidence index.
- The 2026-10-19 hosted repeat on commit `7ebc9c46aae30c18ea03e5d2568f51f0bb4cf77e`
  and source fingerprint `7533e8ab5ce652c5483b11ddacfd638709a998721f70c460ae46d4b1ca011e24`
  confirmed the user-completed browser payment and passed ten checks, including paid
  lifecycle, ambiguous-response reconciliation and fixed-plan conversion. The final
  webhook check failed: 24 signed deliveries were received without signature rejection,
  but all 15 relevant inbox receipts remained quarantined. The runner's `--latest`
  listener used `2026-09-30.endive`, while the application still pinned `2026-08-26.dahlia`;
  the sandbox default was `2026-06-24.dahlia`. Test clock deletion and product, price
  and Portal deactivation were independently confirmed. This attempt is retained as
  failed and does not accept the hosted repeat gate.
- The selected OpenFGA model passed 28 policy cases and four contextual assertions.
- Renewed performance smoke passed 3,331/3,331 operations. The full **30-minute run
  passed 442,464/442,464**, with zero failures/retries and unchanged implementation
  `8d1cce54de8d67796bd9ebbb5a322d7d5d7cfc82324500538cf57a4a71dae52e`.
  Read/write p95 was **196/677 ms** (limits 500/800 ms); authorization fence p95 was
  **57 ms** (limit 100 ms); create-to-readable and source-commit p95 were **720/704 ms**
  (limits 2,000 ms). It confirmed 23,177 shares and 21,064 revocation denials, with
  zero persisted permission tuples.

The renewed performance workload uses the original 50 clients (25 RPC / 25 REST),
100 tenants, 1,000 memberships and 100,000 Projects with the hot/sparse access mix.
Its explicit monthly Project-create allowance is 1,000,000 so the full run can continue;
the finite quota check, reservation, append-only ledger and aggregate writes remain enabled.
This measures the actual in-process API boundary, excluding the TCP/Next.js wrapper.

The retained failed/interrupted runs include a sandbox-denied initial install, an intentionally
interrupted benchmark before the worker connection-loss fix, a quoted SQL identifier fix, historical migration-count
expectations, the new counted-seat insertion compatibility trigger, an API test fixture reused
across transports, a Next.js live-region selector conflict, and a due-time test precision race.
The notice fixture now schedules retries explicitly in the past instead of relying on rounded
millisecond `now()`. Stripe sandbox failures exposed the need to settle the prior simulated
renewal before testing the next delinquency; otherwise provider dunning correctly canceled it.
The corrected successful run is distinct from those failures. Missing documentation references
during drafting were reported by the skill checker and are rerun after documentation exists.

## Endive compatibility update — 2026-10-19

The user selected API/event version `2026-09-30.endive` after the retained version-mismatch
failure. The application and sandbox now use exact Stripe SDK 23.0.0. Checkout uses the
Endive `allowed_payment_method_types` parameter with the existing card-only selection;
no removed `payment_method_types` request parameter is sent. The CLI listener verifies its
reported version against the application pin before requesting a browser payment. Both
missing and mismatched listener versions were rejected by a synthetic prerequisite check;
that check is not real Stripe evidence. Older signed event versions remain quarantined.
The shared sandbox default, applied migrations and sold catalogue history were not changed.

The updated source passes a frozen Bun install, source checks, strict types, Knip, all
158 unit cases, 20 billing/API/migration integration cases and the production build.
The retained Phase 0 unit subset also passed (79 cases); its 52 integration cases were
skipped by that command's configuration and are not claimed as executed.

The first Endive repeat (`70f74669-2047-454d-834c-3e7d0565f39e`) timed out awaiting
browser payment. Its test customer was deleted at 14:00:08 UTC; Stripe recorded no card
decline for it, and the stale unpaid Checkout was subsequently expired explicitly. This
failed attempt remains in the evidence index.

The fresh repeat (`8866f5d7-fac6-43ce-ad14-e25dd8cffe03`) **passed all 11 checks** on
unchanged source `773e00c52cdaf31d4dc78d503c656b571e80cf0256da21bebe3786659953e290`.
The user completed hosted Checkout; Stripe confirmed payment and the application granted
active access only after reconciliation. Paid upgrade/ambiguous-response recovery,
renewal downgrade, delinquency/recovery, cancellation, fixed-plan trial conversion and
real signed webhook replay passed. The listener received 19 deliveries with zero
rejections; 15 relevant inbox events were processed with `2026-09-30.endive`. The report
has `accepted: true`, no failure and no remaining provider limitations. Independent cleanup
confirmed deletion of the test clock and deactivation of the product, both prices and
Portal configuration; local installation cleanup reported no failure. This closes the
final-source hosted Checkout repeat gate.

The local dependency vulnerability scan at that checkpoint did not complete: both the mirror and official
registry database downloads timed out or were interrupted after stalling. No new scan pass
or exception was claimed for that attempt. The later hosted run below supplies current dependency/image evidence.
Historical image, performance and
independent candidate evidence retains its original source/SDK scope; this update does not
relabel it as a run against the upgraded dependency. The candidate trials below used SDK
22.6.2, not SDK 23.0.0. No independent authoring repeat for the Endive upgrade is claimed.

## Independent skill acceptance — 2026-10-19

The [Phase 5 evaluation](evaluation.md) closes `R-SKILLS` using two independent live coding
agents, evaluator-owned expectations and actual candidate implementations. Both pass all five
tasks, seven held-out integration assertions plus one browser journey, 138 unit cases, and
their complete integration suites (191 and 189 cases). Source/types/Knip/build,
unchanged-request repeats, retained real-data checkpoints and seven actual Stripe test-API
checks per candidate pass. All 111 protected baseline hashes remain unchanged. The
[versioned index](evaluation-2026-10-19.json) retains provenance, source diffs, failures, the
evaluator-only browser setup correction and the shared-host isolation limitations.

These disposable feature trials are separate from the successful Endive hosted repeat and
hosted CI, and do not claim new production image/performance or M2 acceptance.

## Hosted CI and security gate — completed 2026-10-19

[GitHub Actions run 39271661736](https://github.com/dani-beltran/saas-cook/actions/runs/39271661736) passed all nine jobs:
source, unit, integration, browser, Storybook, production, monetization, image and the final
`required` gate. PR head was `e2a17023516146b1422befbfb78f47d524cbb984`; GitHub tested
merge commit `48ac5ee04309ce5946769ae481e9d05dc2a99e59`.

Both current Trivy policies passed with zero blocking findings and no exceptions. The
Linux amd64 image `sha256:c2e8ddfe42140e21be78e24e803a2cfbfe14ed6bb793d99ee51fb317c47bb0b3`
passed all 16 image acceptance checks on Node 24.22.0. Its implementation fingerprint is
`bf2d643cdc07137a1ae633fef0f6332312bef93ac17a94249b2733fc44328424`.
The evidence index records report hashes. The first failed scan and cancelled intermediate
runs remain historical attempts; they are not counted as passes. Later source changes need
their own successful required workflow.

## Remaining gates and limitations

Hosted GitHub CI and current dependency/image security gates are **completed**. Independent
skill candidate evidence remains scoped to its recorded SDK 22.6.2 baseline; no independent
authoring repeat for the subsequent Endive compatibility update is claimed. This CI result
does not broaden those historical evaluations or accept M2 Commercial/Phase 6.

No production pricing, live-mode charge, external customer email, deploy, application-data
migration, Phase 6 capability or Backoffice acceptance is implied. Review-mode commands are
never force-resubmitted beyond the provider idempotency horizon. A genuinely unresolved
provider result/customer mapping requires investigation and stays blocked rather than risking
another semantic charge. See [operational constraints](README.md) before enabling billing.
