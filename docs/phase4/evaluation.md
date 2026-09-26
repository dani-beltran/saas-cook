# Skill behavior evaluation

`R-SKILLS` requires actual AI edits in disposable application copies, held-out behavioral checks and ordinary application checks. Passing the deterministic tests for the runner or skill packaging does **not** establish this acceptance. The runner never calls an AI service, installs an agent, reads a user's agent credentials, or runs the Phase 3 benchmark.

Use the six skills with an explicitly selected coding agent. Give it only the candidate directory and the task briefs. Restrict its editable filesystem to that candidate using the host's agent sandbox. The separate evaluator/control directory is evaluator-owned: the authoring agent must neither inspect nor edit its expectations. Directory separation and SHA-256 checks detect unexpected changes; they are not an operating-system security boundary against an unrestricted agent. Do not give the agent production credentials.

## Prepare two independent runs

From the template root, prepare a new directory under `/private/tmp` or ignored `artifacts/`:

```sh
bun run skills:evaluate prepare \
  --output /private/tmp/skills-release \
  --evaluators evaluations/phase4/heldout \
  --briefs evaluations/phase4/briefs \
  --repeat 2
```

Use the actual brief directory shipped with the evaluation manifest. Preparation creates `run-1/candidate` and `run-2/candidate`. Each starts from the same source and independently covers all ten §5.7 tasks. Dependencies are installed separately with `bun install --frozen-lockfile`; no Git metadata, `node_modules`, `.env`, credential files, build products, evaluator source or historical evaluation output is copied. `.env.example` remains available as the synthetic local setup reference. Git-tracked and untracked non-ignored project source, including `.agents/skills`, is captured. Deleted tracked files remain deleted.

The isolated fixture omits `scripts/phase4`, `docs/phase4`, `evaluations` and the
catalogue integration test that imports the omitted controller helper. Run
`skills:check` in the template repository; the separate controller runs the
candidate's application commands and held-out domain assertions. This fixture
is not a Git clone or a test of packaging every controller command into a
downstream product. Prior migration hashes are checked externally because its
Git history is deliberately absent.

`manifest.json` records the template commit, exact source hashes (including uncommitted changes), skill/reference hashes, all ten task IDs with stable requirement IDs, and the declared repeat count. The control snapshot includes the starting source, briefs and evaluator files. Keep these artifacts with the release evidence. Changing guidance, shared references, task requirements or the supported agent/model configuration requires preparing fresh affected evaluations.

If candidate creation and agent dispatch happen outside the runner, preserve the actual starting source **before** the agent edits it:

```sh
bun run skills:evaluate snapshot \
  --candidate /private/tmp/manual-run/candidate \
  --output /private/tmp/skills-initial-source
bun run skills:evaluate prepare \
  --output /private/tmp/skills-release \
  --evaluators evaluations/phase4/heldout --briefs evaluations/phase4/briefs \
  --baseline /private/tmp/skills-initial-source --repeat 2
bun run skills:evaluate adopt --output /private/tmp/skills-release \
  --repeat 1 --candidate /private/tmp/manual-run/candidate
```

Adoption retains a source copy and checks the real external candidate in place, so its already-installed dependencies remain usable without copying them. It resets prior evidence and checks for that repeat. The original template commit remains recorded alongside exact baseline hashes; the baseline may include explicit synthetic customization. Never reconstruct a claimed pristine baseline from the agent's completed work.

## Record real agent evidence

Retain the actual task prompt, replies, tool actions and command evidence from the selected agent. A prose assertion of success is not a substitute for this transcript. Record the provider, exact model identifier exposed by the host, agent settings, discovery/invocation method and task coverage. When the host does not expose a model identifier, state that it is opaque rather than inventing a version, and include the host/session configuration needed to identify the run.

Write a JSON evidence input outside the candidate:

```json
{
  "kind": "ai-agent",
  "provider": "selected agent host",
  "model": "exact model identifier or explicitly opaque host selection",
  "configuration": {
    "agentVersion": "record the actual version",
    "reasoning": "record the actual exposed setting",
    "skillDiscovery": "record explicit skill paths or native discovery",
    "sessionId": "actual run identifier"
  },
  "taskIds": ["task-01", "task-02", "task-03", "task-04", "task-05", "task-06", "task-07", "task-08", "task-09", "task-10"],
  "transcriptPath": "/absolute/path/to/actual-agent-transcript.md"
}
```

```sh
bun run skills:evaluate record --output /private/tmp/skills-release \
  --repeat 1 --evidence /private/tmp/run-1-evidence.json
bun run skills:evaluate run --output /private/tmp/skills-release --repeat 1
```

Repeat with the independently executed second candidate and its own transcript. The runner copies and hashes transcripts; it does not attest to a provider's identity or authenticate a transcript's provenance. Reviewers must inspect the original host evidence. Synthetic transcripts in runner unit tests exercise bookkeeping only and must never be submitted as release evidence.

`run --tasks task-02,task-07` supports targeted diagnosis. Final acceptance still requires every declared task in both independent runs. Recording new agent evidence clears old check results; changing candidate source invalidates previous results and requires rerunning all affected checks. Do not splice results from different source versions together.

## Held-out check contract

The evaluator directory contains `manifest.json` and its evaluator programs. Its task entries must cover exactly `task-01` through `task-10`, with unique check/case IDs and nonempty required case sets:

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "task-01",
      "brief": "task-01.md",
      "checks": [{
        "id": "crud",
        "argv": ["node", "{evaluators}/check.mjs", "task-01"],
        "caseIds": ["create", "restore", "sharing"],
        "timeoutMs": 300000
      }]
    }
  ],
  "applicationChecks": [{
    "id": "typecheck",
    "argv": ["node", "{evaluators}/application-check.mjs"],
    "successPattern": "^APPLICATION_CHECK_PASSED$"
  }]
}
```

The abbreviated example needs the other nine task entries before preparation succeeds. Commands run directly without a shell in the candidate working directory. `{candidate}`, `{evaluators}` and `{template}` expand to absolute paths; `{template}` permits a trusted dependency loader. Import the candidate's source for behavioral tests, not the original template's implementation. Child processes inherit only `PATH`, `LANG`, `CI` and `PHASE4_CANDIDATE_ROOT` / `PHASE4_EVALUATOR_ROOT`. The invoked tool selects its own `NODE_ENV` (test for Vitest, production for Next build). Trusted evaluator setup must explicitly supply disposable local service configuration; it must not consume production environment settings.

Each task check emits exactly one machine-readable line after running all named cases:

```text
PHASE4_RESULT={"taskId":"task-01","checkId":"crud","cases":[{"id":"create","status":"passed"},{"id":"restore","status":"passed"},{"id":"sharing","status":"passed"}]}
```

Exit zero alone is insufficient. Missing, unexpected, duplicated, failed or skipped cases fail the check. Evaluator authors must derive case outcomes from actual assertions, never print a unconditional success marker. Real-service cases must exercise PostgreSQL and OpenFGA; missing services fail. A test for a deliberately broken feature passes only when its required behavioral failures are actually demonstrated and the agent identifies them.

Ordinary deterministic application checks are recorded separately and require successful command exits and declared output markers. Their wrappers must fail on missing or skipped required suites. The shipped wrappers require fresh Vitest/Playwright JSON, frozen baseline case identities (including duplicate-title counts), and successful added cases. Historical regression sources are also hash-protected. A missing case, skipped case, expected browser failure or retried browser result cannot satisfy acceptance. The held-out control hashes are checked before and after commands. Candidate source changes during checking fail the run. Source diffs include only source snapshots, so locally installed dependencies, credentials and generated logs are excluded. Command output and failed checks remain under each run's `logs/` directory.

## Release decision

```sh
bun run skills:evaluate summary --output /private/tmp/skills-release
```

The summary exits nonzero for missing agent evidence, absent tasks, failed required cases, failed repeats, missing application checks, changed source or modified evidence. Preserve the JSON result, transcripts, source diffs, manifest, held-out checks and command logs under the release's ignored artifact directory; commit only the concise evidence index and accurate acceptance status. Do not turn unrun checks or an opaque model version into a reliability claim. Ordinary CI runs the deterministic skill/runner checks without a live AI service. The separate release evaluation is the evidence for agent behavior.
