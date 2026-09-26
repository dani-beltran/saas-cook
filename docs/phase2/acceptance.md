# Phase 2 acceptance record

Date: 2026-09-26. Preset: Foundation identity, tenancy and organization/team authorization. Suite: Phase 2, version 2. Synthetic local PostgreSQL, independent control PostgreSQL, OpenFGA, SMTP/Mailpit and S3 services; no commercial credentials.

**Phase 2 implementation and local acceptance passed.** These results cover the current working tree on base commit `ba69e9db080ad032d91fd204d62ace03deb09c65`, including uncommitted changes. They do not claim hosted CI or a template-release milestone. Phase 1 evidence is retained separately.

| Executed check | Result |
| --- | --- |
| Frozen Bun install; Biome; TypeScript; Knip | Passed |
| Unit tests | 54 passed; no failures or skips |
| Real-service integration | 58 passed; no failures, errors or skips |
| Chromium browser acceptance | 7 passed; no failures, retries or skips; desktop/mobile screenshots reviewed |
| Production and Storybook builds | Passed |
| Production contextual authorization model | 4 assertions passed |
| Phase 2 image acceptance | 14 checks passed on Linux arm64; Node.js 24.21.0 runtime |
| Dependency and exact-image vulnerability policies | Passed with no high/critical findings and no exceptions; image reports 15 medium and 7 low findings |

The tested image is `sha256:cbab47e0d69dc927a79165a9d54b0276fc8e65b366d0613c1ee0e4a69e99bedf`. Its implementation fingerprint is `12846b14b37d313a3bd6836e1f95c9055d89f733d0f9f4af89808348fdd3c61b`, matching the current implementation and test inputs. See [verification](evidence/verification.json), [image acceptance](evidence/image-acceptance.json), [model assertions](evidence/authorization-model.json) and [scan summaries](evidence/security.json).

## Requirement mapping

| Gate | Implemented behavior and acceptance coverage |
| --- | --- |
| `R-TENANCY` | Actual restricted roles, duplicate memberships, two organizations for one user, missing/pooled tenant context, cross-tenant composite references and per-tab navigation. `packages/db/src/tenancy.integration.test.ts`, `packages/db/src/migrations.integration.test.ts` and `tests/e2e/identity.spec.ts`. |
| `R-LIFECYCLE` | Sorted user fences before organization fences, freeze/admission, reciprocal transfers, recipient deprovisioning and in-flight session revocation. Tenancy and identity integration suites. |
| `R-AUTHZ` | Production contextual compiler/evaluator, fresh namespaces, pinned model, revocation, late persistent grants, lost lock-bearing connection, expiry during HTTP latency, actual timeout/outage and independent epoch/readiness mismatch. `packages/authz/src/authorization.integration.test.ts` and compiler/operator unit tests. |
| `R-SEATS` | Shared transactional admission, last-seat invitation/reactivation race, billable-classification race, idempotent release and recovery capacity denial. Four transfer outcomes verify immediate occupancy and permissions. Tenancy integration suite. |
| `R-OWNER` | Voluntary last-owner refusal, security deactivation during FGA outage, independently signed exact-target approvals, fresh MFA, replacement admission and successful current FGA evaluation before reopening. Tenancy/authorization integration and signed-approval unit suites. |
| `R-MAGIC` | Hashed expiring links, atomic single use across processes, scanner confirmation, generic responses, safe destinations, lifecycle/epoch checks and shared per-identity/source limits. Signed ingress proofs reject forged headers, malformed addresses and stale proofs. Identity integration, ingress unit and real browser registration suites. |
| `R-PASSKEY` | Multiple credentials, authenticated enrollment, freshness, origin/RP/challenge/signature/UV enforcement, revocation with recovery-factor protection, passwordless TOTP and one-use recovery codes, actual Chromium WebAuthn sign-in. Identity integration and browser suites. |
| `R-TRANSFER` | Verified active recipients, fresh acceptance, expiry/cancel/version/tenant checks, deprovisioning races, publication rollback and admin/member/billing/departure outcomes. RPC/REST/browser checks cover the legacy member default, selected departure, seat release and immediate former-owner denial. |
| `R-EMAIL` | Encrypted short-lived outbox, retry, payload clearing and all seven English/Spanish identity/security templates delivered through real SMTP with Mailpit content assertions. Browser journeys consume actual registration/invitation/transfer mail. Tenancy tests cover notification transaction rollback. |
| Phase 2 `R-IMAGE` | Real packaged migration/replay, interrupted/resumed bootstrap with unchanged independent binding/epoch, existing/restored-data rejection, publication, assets/native dependencies, non-root process supervision, credential isolation and readiness failure. `scripts/phase1/image-test.ts`. |

Team administration exposes current members, targeted membership removal and team deletion through the same tenant authorization service. Ownership transfer records and displays the outgoing owner's selected outcome. Failed identity actions use sanitized server-correlated security events; verified actors have an independent bounded durable audit budget, so anonymous failures cannot suppress it.

Provider throttling uses an atomic PostgreSQL upsert on the existing lifecycle-fenced connection. A deterministic concurrent-first-request regression reproduced the prior transaction-abort failure and now passes, including threshold and expiry checks. Provider buckets derive only from verified ingress metadata or the shared fallback; rotating unsigned forwarding headers cannot create independent allowances. Expired bucket cleanup is capped and skips locked rows.

## Reproduction and evidence

Use the [Phase 2 verification commands](README.md#verify). Browser and worker acceptance create isolated migrated and bootstrapped installations; they do not reuse or reset an existing local application. PostgreSQL test administrators are used only to create and remove those fixtures. All runtime queries use their restricted roles. The previous-schema fixture remains a Phase 1-to-Phase 2 development fixture, not a released-product upgrade claim.

Full logs, JUnit XML, Playwright traces/screenshots, build output and vulnerability reports live under ignored `artifacts/`. Selected machine-readable verification, image, model and scan summaries are retained in `evidence/` with the source commit, dirty-tree status and implementation fingerprint. The fingerprint includes the implementation, test harness and CI inputs and excludes documentation/evidence to avoid self-reference.

The pre-fix browser failures are retained under `artifacts/phase2-failures/`. Local validation used a separate disposable S3 instance on port 19001 with the corrected 32-volume configuration; the existing local S3 data was preserved. A fresh `services:up` uses that corrected capacity directly.

## Scope and limits

- The signed ingress contract in [the runtime guide](README.md#authentication-ingress-and-security-recording) must be configured at a production proxy for distinct client-source limits. Local development intentionally shares one source bucket. Unsigned forwarding headers never establish source identity.
- Identity requests and templates support English/Spanish. Domain invitation/transfer/recovery notifications currently use the documented English default.
- Phase 3 owns resource authorization, Projects, workspaces, service principals/API keys and real-feature performance. Phase 5 owns provider billing/downgrade integration. Phase 7 owns real SCIM and operator UI.
- Phase 6 owns full application restore, credential replacement and independent deletion-journal replay/revalidation. Phase 2 owner recovery cannot release a globally unverified restored installation.
- Image acceptance tests packaged initialization/publication; signed operator mutations run in the real-service integration suite. Image checks cover operator packaging/help and missing-credential refusal.
- Hosted GitHub Actions and Linux amd64 have not been run locally. Local results do not establish hosted CI success or a template-release milestone. The broader roadmap release checklist includes later phases and remains open.
