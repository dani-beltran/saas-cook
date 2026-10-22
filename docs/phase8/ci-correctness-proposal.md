# Approved CI correctness smoke contract

Status: explicitly approved by the user on 2026-10-22 after review of the separate CI outcomes. This is a material change to the required CI contract. The unchanged strict full benchmark remains mandatory for release.

The corrected hosted smoke completed 2,659/2,659 operations on a 4-vCPU EPYC 7763 with read/write p95 619.6/1,204.9 ms. Every other measured gate passed. These are failed strict performance results. Host-dependent latency differences motivate this proposal; they do not prove a production bottleneck or justify an application optimization.

The default CI command is `bun run phase8:performance:ci`, which explicitly selects `--ci-smoke`. It performs the same workload as the existing strict smoke and writes two separately named outcomes:

| Outcome | Required result |
| --- | --- |
| `performance-smoke` | Every existing target, including reads <500 ms and writes <800 ms. Misses remain failed, with the original report and receipt retained. |
| `performance-ci-correctness` | Every gate except those two CRUD latency targets must pass; both targets remain measured and reported as failures. Unknown/missing checks, missing measurements, dirty/stale source, execution/cleanup failure or any other failed gate fails CI. |

The CI report hashes its strict receipt, raw report and isolated-environment evidence and prints the measured failed targets prominently. Dependency health and owned-environment cleanup are mandatory gates. It always records `acceptanceEligible: false`. The release checker rejects this receipt in place of `performance-full`. This policy introduces no `continue-on-error`, retries, client reduction, dataset reduction, pool changes or target increases. All modes use the same separately hardened isolated service environment. Ordinary `phase8:performance:smoke`, full `phase8:performance` and manual `phase8_full=true` keep their strict outcomes and exit behavior.

Review decision: adopt this explicitly narrower PR check while retaining mandatory full reference-host performance acceptance. Passing a future full reference-host run will not retroactively pass any retained failed hosted smoke or establish capacity on different hardware/architecture.

Deterministic coverage verifies mode selection, every mandatory gate, immutable linked evidence and release rejection. Real image execution and hosted CI remain separately required; approval of this contract does not establish that those checks passed. The candidate acceptance record retains their actual results and limitations.
