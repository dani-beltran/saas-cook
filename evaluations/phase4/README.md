# Foundation skill behavior evaluations

These are evaluator-owned fixtures, not generated application source. The runner
copies the public task briefs into each disposable candidate and keeps this
directory's held-out checks outside it. Candidates use real disposable
PostgreSQL/OpenFGA installations and synthetic identity data; no commercial
provider is enabled. See [the runner guide](../../docs/phase4/evaluation.md).

Two independent candidates form the declared repeat set. Run the add workflow,
then the evolution workflow against existing rows, interrupt/resume and repeat,
then the verification workflow. Capture actual agent messages and source diffs.
Deterministic regression checks alone are not agent behavior evidence.

`seeded-review/` contains an intentionally defective Widget proposal for task
10. It is never installed as application code or a reviewed migration. The
controller stages it under each candidate's ignored artifacts after authoring,
and a separate verification agent reviews it against real-service checks.
Retain all three expected failing assertions and the agent's source-grounded
findings; an arbitrary nonzero command or a missing dependency is insufficient.

The controller freezes required test identities in `heldout/baseline-cases.json`,
including repeated parameterized names as a multiset. Reused regression and unit
suites may add cases, but cannot remove or skip an original case. Historical
fault-test source hashes remain exact. Update this evaluator-owned inventory
through review when a baseline contract intentionally changes; candidate edits
do not change it. Vitest and Playwright wrappers require fresh structured
reports in unique attempt directories and reject missing, skipped, failed,
expected-failing or retried required cases. The independent directory case and
all focused held-out cases have explicit identities as well.

Browser evaluation runs each discovered spec in its own disposable installation,
matching the application's authentication-throttle isolation. Every invocation
keeps a fresh JSON report and diagnostic directory, uses zero retries, and must
execute passing cases. The combined reports must satisfy the complete frozen
case multiset; added specs are checked too. The current inventory follows the
reviewed Organization-to-Projects contract and includes the newer dashboard,
example-customer and personal-settings cases. Applied migrations and snapshots
through `0009` are frozen without changing any predecessor digest; retained
Phase 0 fault source hashes and cases remain unchanged.

The historical Phase 3 performance gate is excluded by the implementation
request. Neither a short smoke nor an ordinary regression suite replaces it.
