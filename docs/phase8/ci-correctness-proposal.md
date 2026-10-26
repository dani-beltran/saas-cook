# Approved consolidated CI correctness smoke contract

Status: the user explicitly approved the read/write CI timing exception, then the narrow fence-wait timing amendment on 2026-10-22. The user also requested benchmarks only after all implementation work is consolidated in the final integration PR. Ordinary PR and main-push image CI therefore performs image acceptance, recovery and security checks without a performance workload. Passing ordinary required CI is not performance acceptance.

The retained hosted smoke completed 2,659/2,659 operations on a four-vCPU EPYC 7763 with read/write p95 619.6/1,204.9 ms; every other gate passed in that run. Later Next.js 16.4.1 hosted results included fence p95 54 ms, an indeterminate conservative 100 ms boundary bucket, and an unambiguous 111 ms miss across shared runner CPU models. The performance/authorization harness, workload and budgets were the same; the entire application runtime was not identical because template email-branding changes landed between PR19 and PR20. These failed strict results remain retained. They do not prove a production bottleneck, establish capacity or justify an application optimization.

After implementation is complete, dispatch the CI workflow on the completed final integration branch or main with `phase8_ci_smoke=true` to run `bun run phase8:performance:ci` explicitly. It performs the unchanged smoke workload and writes two outcomes:

| Outcome | Required result |
| --- | --- |
| `performance-smoke` | Every existing target, including read p95 <500 ms, write p95 <800 ms and authorization fence p95 <100 ms. Misses remain failed, with the original report and receipt retained. |
| `performance-ci-correctness` | Every gate except those three timing targets must pass. All target misses remain measured and reported. Missing or corrupt telemetry, unknown/missing checks, dirty/stale source, execution/cleanup failure or any other failed gate fails CI. |

Fence observation validity is mandatory independently of latency. The driver couples valid, positive web observations to authorization. The CI evaluator independently recomputes web/worker threshold proofs and summary statistics from the hashed raw report, requires one observer of each role, verifies every reported proof/statistic and the strict fence outcome, and rejects zero web observations. Valid empty worker observations remain allowed. Raw threshold counts decide the exclusive 100 ms boundary; a conservative histogram bucket is not treated as an exact raw percentile.

The CI report hashes its strict receipt, raw report and isolated-environment evidence, and prominently prints `failedLatencyTargets`, including raw fence proof and its percentile representation. Dependency health and owned-environment cleanup remain mandatory. The CI receipt always records `acceptanceEligible: false`; the release checker rejects it in place of `performance-full`. No `continue-on-error`, retries, reduced clients/dataset, pool changes or target increases are introduced. All modes use the same isolated service environment.

The existing manual `phase8_full=true` dispatch still runs the strict full workload with a 90-minute image-job budget; full takes precedence if both manual flags are selected. Both flags default to false and benchmark steps explicitly require `workflow_dispatch`, so ordinary PR/main events run neither. Local `phase8:performance:smoke` and `phase8:performance` keep their strict outcomes and exit behavior. Use these commands only for the completed integration candidate, unless investigating an explicitly scoped failure.

The full reference-host benchmark remains mandatory for release on the final clean source and its exact image. Old full evidence is retained only for its actual source/image; new instrumentation or source changes require current-candidate verification under the release contract. Neither a passing diagnostic CI result nor the existence of this policy completes that acceptance. Failed hosted measurements are never retroactively changed by a later passing full run.

Deterministic coverage verifies mode selection, every mandatory gate, immutable linked evidence, independent malformed/empty fence rejection and release rejection. Real final-candidate execution remains separately required; the acceptance record retains its actual results and limitations.
