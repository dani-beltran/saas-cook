# Phase 4 acceptance record

Phase 4 passes its local `R-SKILLS` behavior gate: all ten tasks pass in each of
two independently authored candidates, alongside their application checks. The
six skills, shared references, four example briefs, deterministic guards and
evaluation runner are implemented. See the [evidence index](evidence/release.json),
[evaluation protocol](evaluation.md) and [guide](README.md).

## Scope and provenance

The template commit is `3f8b7f1ba24fce6f03f6a608719a8b2e8d47781f`. The evaluator
also records the actual uncommitted starting source, six skill hashes, reference
hashes, public task briefs and controller checks. Two separate author sessions
work from independent application copies with separately installed frozen Bun
dependencies. Their Task, renamed Northstar product, directory and security
email remain disposable outputs; they are not installed in the reference domain.

Actual host session records identify OpenAI `gpt-6-astra`, reasoning `ultra`,
runtime `0.158.0-alpha.2.1`; local application tools use Node `24.19.0` and Bun
`1.4.2`. Public prompts, replies and tool actions are exported from those records.
System/developer instructions, private reasoning and guardian sessions are
excluded. The backend version beyond the exposed model identifier is unknown.

These are supervised trials with retained failures and repairs, not a claim of
first-attempt success or universal reliability. The application baseline was
preserved before edits. Final skill references were synchronized and explicitly
read by both authors during initial work; the earlier capture and the follow-up
instructions remain in the evidence. Source snapshots and hashes make this
sequence inspectable rather than reconstructing a pristine baseline afterward.

The final evaluator adds frozen baseline case identities and structured-report
validation after independent review. Both completed candidates were rerun
unchanged against that new control snapshot. Separate source copies, dependency
installs and author instructions provide workflow isolation; the host sandbox
is shared and does not enforce a filesystem boundary between agents.

## Required behavior coverage

| Task | Required outcome |
| --- | --- |
| 01 | Renamed product, existing Project CRUD/restore/sharing, migrated app and worker |
| 02 | Task CRUD, current parent inheritance, tenant-composite FK and forced RLS |
| 03 | Overlapping tenants, current grants, scoped keys and declared API capabilities |
| 04 | Current contextual fault/parity tests and actual retained projection/context regressions |
| 05 | Strict DTO/input boundaries, bounded actor-bound cursors, stale versions and content-free audit |
| 06 | Atomic replay/event behavior and existing final-capacity races with billing disabled |
| 07 | Real predecessor data through optional/required fields, backfill, storage rename and changed completion permission |
| 08 | Captured notes-only interruption, explicit resume, custom-file preservation and source-identical repeat request |
| 09 | Existing-service directory and post-commit security email, translations, keyboard/UI states and retries/redaction |
| 10 | Independent review identifies three seeded defects, each backed by an actual failing behavioral assertion |

The held-out tests execute against each candidate's own source with real local
PostgreSQL and OpenFGA. Required selected cases cannot skip. The seeded review
proposal intentionally fails its security assertions; acceptance requires the
verification agent to identify those failures, not to treat a failed feature
as deployable. Tests for other task IDs excluded by an explicit focused selector
are not counted as coverage.

Earlier attempts retain the defects and repairs they exposed: deleted Task
reads, localized directory rendering and accessible status/alert selectors. A
Project signup timing failure in the first full browser attempt passed an
unchanged targeted retry and the final complete suite. Required assertions were
not relaxed to obtain those passes. The final review also tightened evaluator
report handling so future skipped or missing regressions cannot satisfy the gate.

## Deterministic application evidence

- Root source, typecheck and Knip pass. The final production build uses
  `bun --no-env-file run build`; local services were available during this run,
  so it is not additional evidence of service-unavailable build behavior.
- All 105 root unit cases pass, including runner integrity/failure retention and
  seeded DTO/capability/migration controls.
- The full `skills:check` command passes 37 focused unit cases and 92 real-service
  DB/API/authz cases. Four catalogue cases discover tenant tables and exercise
  missing RLS, permissive policies and non-composite tenant relations. Every
  invocation retains its own report/log directory and a latest report pointer.
- Candidate-specific application and held-out results are recorded separately
  by the release runner. The two candidates pass 95 and 89 unit cases and
  14 and 13 browser cases respectively, plus an independent directory browser
  case each. Build, typecheck or attractive UI alone cannot satisfy the matrix.

Image acceptance, vulnerability scans and remote GitHub CI have not been rerun
for this local Phase 4 change; no result for them is claimed here.

The missing corrected Phase 3 benchmark is explicitly excluded by the user.
`R-AUTHZ-PERF` stays pending; neither benchmark nor performance smoke is run.
The complete Foundation milestone therefore remains open even after the skill
behavior gate is accepted.

## Retained evidence

The versioned [release index](evidence/release.json) records model/session and
source/control/transcript hashes, requirement IDs, case totals and log hashes.
The complete local bundle is under
[`artifacts/phase4/release-verified`](../../artifacts/phase4/release-verified);
its `prior-attempts.json` links the earlier controls and retained repairs. Both
actual interruption snapshots, source-identical repeat hashes, independent
review reports and author diagnostics are retained. Full artifacts are ignored
local evidence; they have not been uploaded as remote CI artifacts.
