# Backoffice first-slice verification — 2026-10-21

Status: **implemented; blocked local validation completed; release acceptance pending**. This is a working-tree follow-up to `94507a78d7f17f4c134570f0bcab8d70862c272b`. The canonical gate register remains [the roadmap](../06-delivery-roadmap.md#backoffice-acceptance-register). No full BO gate, Phase 6/M2 release gate or production deployment is accepted by this record.

## Delivered scope

[BO-00](bo-00.md) selects the implementation defaults and records external owners/decisions still required. [Operation](implementation.md) documents the independent app/config/roles, additive `0025` migration, separate operator model/publication, dual-signed invitation/offboarding/re-enrollment commands, verified passkey sign-in, exact-organization grants, forced grant RLS, transaction expiry/offboarding fences and audit-before-disclosure metadata lookup. English/Spanish forms, independent standalone/image packaging and a required CI job are included. Directory search, domain mutations and other Backoffice modules remain planned.

## Final local validation — resumed 2026-10-21

Disk space recovered to 51 GiB free and Docker 29.9.1 was healthy. `bun run services:up` started fresh disposable PostgreSQL, control PostgreSQL, OpenFGA, mail and storage services. No unrelated data, images or volumes were removed in this resumed validation.

Current logs and reports are retained under `artifacts/backoffice/resume/`; prior diagnostics remain under `artifacts/backoffice/evidence/`. `source-images.json` binds both exact images to final source, records the skill/brief/migration hashes and includes the supplemental customer-image isolation result. These are deterministic local application checks, not live-agent skill evaluation or hosted CI results.

| Command / check | Result | Scope / limitation |
| --- | --- | --- |
| `bun run check`, `bun run typecheck`, `bun run knip`, `bun run skills:check --static` | Passed | Source, root/customer/BO strict types, unused code and immutable migration history through `0024` |
| `bun run test:unit` | 182 passed in 35 files | Signed IPv4/IPv6 ingress, exact HTTPS `__Host-` cookie configuration and TLS adapter/body preservation included |
| `bun run test:integration` | **227 passed in 38 files** | Final grant RLS, fresh/predecessor migrations, scoped audit/read denials, delayed FGA/expiry, offboarding, restored-row epoch invalidation and independently approved re-enrollment/replay cases included; 6 BO cases passed |
| `bun run build:backoffice`, `bun run test:e2e:backoffice` | **Passed; 1 HTTPS browser test** | Actual virtual-authenticator enrollment/sign-in, Secure/HttpOnly/Strict host cookie, audited metadata lookup, scope denial, sign-out, Spanish mobile and unsigned-ingress denial. Synthetic localhost TLS, not deployment ingress certification |
| `bun run image:build:backoffice`, `bun run test:image:backoffice` | **Passed on final image** | Non-root Node 24.22.0, standalone assets, no customer app/CLI/migrations, read-only root, signed ingress, readiness, bounded graceful stop; exact source label asserted |
| `bun run image:build`, `bun run test:image` | **Passed on matching customer image with BO stopped** | 17 image checks: packaged commands/migration/bootstrap/recovery, native dependencies, combined web/worker health, private files/export/deletion, credential separation, failure supervision and graceful shutdown |
| Supplemental customer-image inspection | Passed | No BO application, organization lookup route, staff cookie marker or staff UI marker in customer browser bundles |
| `TRIVY_BIN=/tmp/saas-shared-ui-trivy/trivy bun run security:scan dependencies` | Passed | Pinned Trivy 0.69.3, current vulnerability DB, unchanged high/critical policy |
| Same scanner with `security:scan image saas-cook-backoffice:local` and `security:scan image saas-cook:phase2` | **Both passed** | Separate full reports/policy decisions retained for the final exact images; no new exceptions |
| Earlier customer browser/Storybook checks | 54 customer browser tests and Storybook build passed | Retained earlier evidence; not rerun because the resumed source correction affects only BO process shutdown and image verification |

The final code correction is confined to `infra/docker/backoffice-start.ts`: a requested SIGTERM/SIGINT stop accepts Next's normal signal-derived exit code only before the drain deadline; crashes and forced timeout remain failures. `scripts/backoffice/image-test.ts` now also checks the image's source fingerprint and retains container failure diagnostics. Both images were rebuilt after these changes. Application/domain code and migration history were unchanged during this resumed validation; integration and HTTPS results remain applicable.

The Backoffice screenshot `artifacts/backoffice/lookup.png` was visually reviewed after the successful HTTPS test. Earlier signed English desktop/Spanish mobile rendering screenshots remain available. No production identities, credentials or deployment were used.

## Exact source and image pair

- Base commit: `94507a78d7f17f4c134570f0bcab8d70862c272b`, with the recorded working-tree implementation.
- Final source fingerprint: `8f1ec0d15bef036422b92f49b5a2ffeb338bf426ee115498acba4bd8f8bb8320`.
- BO image: `saas-cook-backoffice@sha256:e54edf1c328f624a59c7cf4232b08e32493be2d357292bf846b2a0fe127d47c1`.
- Customer image: `saas-cook@sha256:864ce55bc59da218395731458c0e7ede235f7c3ba806dd4eae45545a0e138a86`.
- Both images: Linux **arm64**, build Node 24.19.0 / Bun 1.4.2, runtime Node 24.22.0. This does not establish amd64 or hosted CI acceptance.
- Operator model hash: `2486634a05f3e6891e758fcb51ffbebc5f64d75a84652f601b503a6802224b0a`.
- Migration `0025` SHA-256: `59c8010bbb82e8c0b1afadda32ad080d0b2432caf86e57a29b21b597ba3e8fe2`.

Both image labels were independently compared with the final working-tree fingerprint. Documentation/evidence are excluded from that fingerprint to avoid self-reference. Supported pair remains BO protocol v1 / application schema through `0025` / unchanged customer authorization model with separately pinned operator publication.

## Retained failure history

The initial implementation run passed 224 integration cases but failed forced grant RLS and two migration-count assertions. Those were corrected before this resumed run; all 227 cases now pass. Earlier HTTP staff-browser evidence preceded final TLS handling and cannot replace the successful HTTPS run above.

The earlier image download first stalled in Docker's credential helper; an anonymous retry fetched the exact pinned Bun digest but the machine exhausted disk space and Docker storage became read-only. That interrupted final integration and prevented further PostgreSQL access. These infrastructure blockers are resolved.

On resume, the first browser attempt failed because the cached Chromium executable was missing. `node node_modules/@playwright/test/cli.js install chromium` restored the pinned binary, then the full HTTPS test passed. The first BO image run exposed a real launcher defect: intentional Next shutdown surfaced exit 143 rather than successful container exit. The launcher was fixed without relaxing the zero-exit image assertion, and the final rebuilt image passed. Failed logs and the missing-browser trace are retained alongside passing reruns; the preliminary passing image scan does not substitute for the final image scan.

## Required before release

The requested local integration, HTTPS passkey and exact-image validation blockers are closed. Remaining release work is separate:

1. Run the required hosted CI/release jobs on the committed source and intended deployment architecture. Preserve the source/image bindings and vulnerability policy; local arm64 evidence does not claim hosted amd64 success.
2. Complete the due operator/customer concurrent workload and broader compatibility/outage evidence. The historical Foundation performance result does not cover operator load; the current exact-image pair and BO-omitted customer checks do not prove every upgrade/blackhole scenario.
3. Complete independent BO-00 deployment/security review: staff cohort/scopes, verification and signing custodians, local-passkey policy or mandatory SSO, ingress/VPN/CIDRs/direct-origin isolation, recovery and audit retention. Review migration/runtime role blast radius and the supported schema/model pair.
4. Review/accept only the due scoped `R-BO-*` gates in the roadmap. Full directory search, later modules and their acceptance remain open.
