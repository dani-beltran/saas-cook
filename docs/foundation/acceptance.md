# Foundation acceptance — Phases 0–4

**Status: accepted on 2026-09-27.** Scope is M1 Foundation: the implemented identity/tenancy, direct-Organization Projects, local entitlements/capacity, scoped service principals, runtime/image and repository-local authoring skills. Commercial, Enterprise and Backoffice modules are not enabled or accepted by this record.

## Acceptance register

| Gate due for M1 | Evidence | Result |
| --- | --- | --- |
| Required Foundation stack, frozen install and developer checks | Hosted source/type/Knip, commit convention, unit, production and Storybook jobs | Passed |
| R-TENANCY, R-LIFECYCLE, R-AUTHZ | 150 real-service integration cases: restricted roles, context/FKs, revocation, current policy, late replies, expiry and rollback | Passed |
| R-PASSWORD, R-MAGIC, R-PASSKEY, R-EMAIL, R-OWNER, R-TRANSFER | Integration and 44 browser cases; verified identity, assurance, encrypted delivery, lifecycle and signed independent operator approval | Passed |
| R-KEYS, R-POLICY, R-SEATS | Current scopes/accounts/grants, declared transports, final-capacity races, replay and local policy with billing disabled | Passed |
| R-WORKSPACES retirement | Applied migration preservation and supported model upgrade, obsolete-field/scope rejection, direct/team grant preservation and inherited-access retirement | Passed; capability remains retired |
| R-AUTHZ-PERF, Phase 3 real feature | Accepted direct-project-v1 30-minute report: 524,149/524,149 operations, zero retries | Passed; carried forward for unchanged production behavior |
| R-IMAGE and security | Exact current Linux amd64 image: 16 runtime checks, dependency/image policies with no blocking findings | Passed |
| R-SKILLS | Two independent current-source trials, all ten tasks, held-out checks and source-preservation repeats | Passed; all ten tasks in both final trials |
| Hosted CI | Source, unit, integration, browser, Storybook, production, image and required | Passed |

## Source and executable evidence

The hosted acceptance run is [CI 36319257546](https://github.com/dani-beltran/saas-cook/actions/runs/36319257546), on branch head `c06ba912955091e38ee287fe86b3a45434b6e241` and tested merge `770d42613f814a1d96df6d6cdf709f315e012720`. All eight jobs passed. Its reports contain **145 unit cases**, **150 integration cases**, and **44 browser cases**, with zero failures, skips or browser retries. Production and Storybook builds passed.

The exact accepted image is `sha256:ef0a9413dc2b558ab34ebda95740ebd793f2dc784322911fdc6f83f7b3d583c3`, Linux amd64, runtime Node **24.21.0**, built with Node **24.19.0** and Bun **1.4.2**. All 16 image cases and dependency/image vulnerability policies passed with no blocking findings or security exceptions. The image's implementation fingerprint is `63a20c792be31ec6236a83939624685a31334bbe864451d08a241813d4fecbbd`.

A preceding local Linux arm64 image also passed the same 16 cases and scan policy at implementation fingerprint `8482f8022253a68f509ba05ed302443a5ff552ca079dc80cdd109310f6c1112c`. The current hosted image above includes the subsequent test cleanup fix and is the selected M1 image evidence.

The accepted [Phase 3 benchmark](../phase3/acceptance.md#accepted-direct-project-performance-result) measured the `8482…` implementation. The broad source fingerprint includes test files. The reviewed delta to `63a20…` changes test database cleanup plus two cleanup regressions; runtime services, authorization model, migration history, dependency/build inputs and the measured workload remain unchanged. Database draining occurs during fixture teardown, outside measured operations. The retained source-delta audit records every changed file and patch hash. This is explicit carry-forward of the existing performance evidence, not a new benchmark claim.

The final local `skills:check` passed **63 focused unit** and **106 real-service integration** cases. The full local integration rerun passed **150/150** with no unhandled errors. Live-agent behavior is recorded separately in the [current Phase 4 evidence index](../phase4/evidence/release-2026-09-27.json). The [executable evidence index](evidence/acceptance-2026-09-27.json) records report hashes and provenance.

## Failures and corrections retained

The first actual main CI run failed its source gate because a feature brief linked to six ignored local artifacts. The brief now identifies those as local evidence paths; clean-checkout reference validation remains strict. The same run passed all 148 original integration assertions but caught four closing-connection errors from forced database teardown. Test fixtures now wait for disconnected clients and drop without FORCE. New real-service regressions prove that an open connection is not terminated and a leaked connection fails cleanup.

The first local cleanup rerun had 12 fresh-authentication denials in unchanged key cases. A clock probe afterward showed approximately zero offset; it did not establish a cause. The unchanged targeted 13-case run, complete 150-case rerun and hosted 150-case run passed. The original failure is retained and is not counted as success.

The live trials exposed deleted Task reads and mobile header overflow in both candidates, plus synchronous invalid-input throws in the first. The authors repaired these and demonstrated source-identical completed-request repeats again. An independent review corrected a directory evaluator that globally matched the shell email and assumed a unique navigation link; negative browser variants still fail for missing authorized data and leaked denied data. A subsequent email rollback fixture omitted the canonical security anchor; it now uses the producer-aligned credential-free URL while preserving every rollback assertion. Independent fault probes reject autocommit delivery and commit-instead-of-rollback. The old frozen controls and failed runs are retained; both unchanged final candidates passed every task under a newly frozen control snapshot.

The live trials are supervised, with failures, repairs and fresh final checks retained. Their Task, renamed product, directory and new security-email implementations remain disposable evaluation outputs. They are not added to the Foundation product.

## Boundaries of this sign-off

The hosting repository is private. GitHub runs every CI job, but its current plan rejects branch-protection configuration with HTTP 403. The `required` aggregate is verified before merging; enforced branch protection is not configured or claimed. The [Phase 1 guide](../phase1/README.md#verify) treats remote protection as separate hosting configuration.

This record accepts requirements due by Phase 4 only. Stripe subscriptions/usage billing, general files/export/deletion, the complete independent recovery journal, cross-resource search/activity/analytics, enterprise SSO/SCIM/custom roles, Backoffice, previous released-product upgrade guarantees and the Phase 8 sustained-image performance gate remain scheduled later. Disabled modules are out of scope, never recorded as passed.

This is development and acceptance evidence, not production provisioning or a tagged Enterprise template release. The current image and live skill evidence do not establish universal agent reliability or performance for changed workloads.

Full local logs, structured reports, transcripts, source snapshots and failed attempts remain under `artifacts/foundation-closeout`. Hosted artifacts were downloaded there and retain their original hashes; GitHub's configured artifact retention is finite. Versioned concise indexes identify the evidence without linking clean checkouts to ignored local files.
