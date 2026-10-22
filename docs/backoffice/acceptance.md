# Backoffice first-slice verification — updated 2026-10-22

Status: **implemented; blocked local validation completed; release acceptance pending**. This is a working-tree follow-up to `94507a78d7f17f4c134570f0bcab8d70862c272b`. The canonical gate register remains [the roadmap](../06-delivery-roadmap.md#backoffice-acceptance-register). No full BO gate, Phase 6/M2 release gate or production deployment is accepted by this record.

## Separate organization detail route — 2026-10-22

The organization overview now has a dedicated localized
`/{locale}/organizations/{organizationId}` route. Both directory row actions and
the manual ID shortcut open it. The directory no longer mounts the overview.
Each detail visit/reload uses current staff/session/scope checks and a fresh audited
lookup. Only the case identifier is handed off in per-tab session storage; it is
excluded from the URL. Direct visits without it require a valid case reference.

Passed source, strict types, Knip, 190 unit tests, 16 real DB/FGA Backoffice
integration tests, Backoffice production build and Storybook. The HTTPS browser
journey verifies shortcut/row navigation, distinct detail URL, absence of the table
on details, reload, out-of-scope denial, direct visits without case context,
case entry and audited disclosure, return navigation, session loss and mobile
layout. Logs and the corrected test that needed a fresh case reference after
returning to the directory are retained in `artifacts/backoffice/detail-page/`.
No schema/model changes, image checks or hosted release sign-off are claimed.

## Paginated directory table — 2026-10-22

Organization cards are replaced by a shared semantic table with masked name,
UUID, lifecycle, observation time and View details. Previous/Next preserves cursor
semantics; row details call the existing audited lookup with the directory case
reference and preserve the current table page. The manual exact-ID form is a
collapsed secondary shortcut below the overview. English/Spanish labels, mobile
horizontal scrolling and keyboard focus on the overview are included.

Passed source, strict types, Knip, 190 unit tests, 16 real DB/FGA Backoffice
integration tests, Backoffice production build, Storybook and the HTTPS browser
journey. The browser covers forward/back pagination, stable page contents,
filters/empty states, exact row UUID/case reference submitted to lookup, returned
metadata and audit reference, preserved table contents, overview focus and mobile
page overflow. Desktop results were visually reviewed. Logs/screenshots and the
corrected old assertion that the shortcut started expanded are retained under
`artifacts/backoffice/directory-table/`. No schema/model change was required;
image scans and hosted release acceptance were not rerun for this UI change.

## Dedicated Staff access page — 2026-10-22

Staff access now lives at `/{locale}/staff-access`, linked from the sidebar.
Authenticated Organizations renders directory, lookup and overview only. The
Staff access route renders session controls, with sign-in/enrollment for signed-out
visitors. Both pages share the existing session verification controller and server
authorization. Sidebar active states and language changes preserve the page.

Passed source, strict types, Knip, 190 unit tests, Backoffice production build,
Storybook and the HTTPS browser journey. Browser evidence covers organization-page
absence of staff controls, sidebar navigation, direct reload of Staff access,
English/Spanish page preservation, return to Organizations, session loss and
sign-out on Staff access. Logs are under `artifacts/backoffice/staff-page/`.
No schema or permission changes were required; image/hosted gates were not rerun.

## Signed-out workspace correction — 2026-10-22

The staff page now mounts organization navigation, directory, lookup and overview
only after a no-store server check validates the current verified operator session.
Signed-out/loading users see sign-in and invitation enrollment; the authenticated
view exposes sign-out. Reload restores valid sessions. Sign-out or session loss
clears the tools and their displayed data, including pending directory requests.

Executed checks: source (four pre-existing informational suggestions), strict
types, Knip, 190 unit tests, 16 Backoffice restricted-role/FGA integration tests,
Backoffice production build and Storybook passed. The HTTPS browser journey proves
initial signed-out tool absence, actual passkey enrollment/sign-in, authenticated
reload, directory/lookup behavior, session-cookie loss and focus revalidation,
sign-in again, sign-out, signed-out reload, session endpoint no-store behavior and
Spanish mobile rendering. Screenshot review confirmed the signed-out layout.
Evidence and the two corrected origin/status assertion failures are retained under
`artifacts/backoffice/auth-view/`; existing proxy behavior was preserved. No image,
full customer regression or hosted release acceptance is claimed by this UI fix.

## BO-02.1 directory verification — 2026-10-22

Implemented the scoped organization directory on the existing exact grants:
masked names, UUID/lifecycle filters, encrypted session/scope/query-bound
pagination, live per-row/page timestamps, audited pages and target disclosures,
and English/Spanish loading/empty/denied/refresh/continuation states. The
[decision](../feature-briefs/backoffice.md#bo-021-directory-evolution--2026-10-22)
records its bounded scope and field allowlists. Apply additive migration `0026`
before the new BO binary; no backfill, new model publication or staff
re-enrollment is required. Existing lookup behavior is retained.

| Check | Executed result |
| --- | --- |
| Frozen Bun install, source, strict types, Knip | Passed; four pre-existing informational Biome suggestions |
| Unit/catalog suite | 190 passed across 37 files, including cursor authentication/context/expiry and strict input limits |
| Focused BO + core migration integration | 24 passed before the additional cross-operator regression; final directory suite has 8 passing cases |
| Full integration run | 236 passed, 2 failed only on stale migration-count expectations (26 versus new 27) |
| Final affected integration rerun | All 10 passed: both corrected legacy migration suites and all 8 directory cases; the full 238-case run was not repeated after the two test-only count corrections |
| Fresh/populated 0025 upgrade/replay | Passed; preserved staff, grants, audit and independent epoch; empty-page deferred expiry rejects at commit |
| Backoffice HTTPS browser | Passed: passkey enrollment/sign-in, 12 scoped organizations over two pages, masks, lifecycle/exact-ID filters, empty and invalid states, live timestamps, sign-out clearing, keyboard use and Spanish mobile layout |
| Customer browser isolation | Passed; both lookup and directory endpoints return 404 on the customer app |
| Production builds | Backoffice and customer passed; workspace-local Turbo cache used |
| Storybook and static skill/migration checks | Passed; masked result and empty-continuation stories included |

Real PostgreSQL/FGA tests also prove actor/epoch/environment RLS, no customer table
reads, no wrong-scope existence disclosure, independent page and target audits,
changed/revoked grants, cross-session/operator/query cursor rejection, publication
and audit failures, and an early grant expiring while a later FGA result is pending.
The final transaction guard rejects the entire late page. English desktop and
Spanish mobile screenshots were visually reviewed.

Evidence is retained in `artifacts/backoffice/directory/`, including
`source-evidence.json`, passing logs and failure history. The first sandboxed
integration invocation could not connect to local services; the authorized local
service run resolved that environment restriction. A synthetic UUID parameter cast
and an ambiguous browser case-reference selector were corrected, with failed logs
and browser traces retained. Earlier schema-count failures are preserved separately.

Source fingerprint: `4ceea750f5fd4ae144c95d3cfa06c8c73d7e09f6ae81fe095cccea0588d468a9`.
Migration 0026 SHA-256: `143c501e8ac3b81ca8ac01a8e8bee32359bbf481804ca59492aa3adbdc0008f6`.
Node 24.19.0 / Bun 1.4.2; synthetic disposable local services. These checks do not
accept the full BO-02 directory/account scope or any release gate. Images/scans,
hosted CI, concurrent customer/operator workload acceptance and independent
security/deployment review were not run in this change.

## Delivered scope

[BO-00](bo-00.md) selects the implementation defaults and records external owners/decisions still required. [Operation](implementation.md) documents the independent app/config/roles, additive `0025` migration, separate operator model/publication, dual-signed invitation/offboarding/re-enrollment commands, verified passkey sign-in, exact-organization grants, forced grant RLS, transaction expiry/offboarding fences and audit-before-disclosure metadata lookup. English/Spanish forms, independent standalone/image packaging and a required CI job are included. Directory search, domain mutations and other Backoffice modules remain planned.

## CI browser assertion repair — 2026-10-22

Run `39780547915` passed source/dependency security, unit, Storybook, production, full integration, monetization, customer image and Backoffice browser/image/security gates on `a9e2f1a`. The customer browser job exposed an ambiguous assertion in the existing Project edit/conflict journey: both the expected conflict notice and a sharing-list loading message have `role="status"` during refresh. The test now selects the conflict message within the editor and asserts visibility, preserving the stale-write behavior check without assuming a single live region. Product behavior is unchanged.

The focused Project browser test passed locally; the full local integration suite also passed all 229 tests across 38 files after the dependency repair. The failed browser log is retained under `artifacts/backoffice/ci-39780547915/`. Hosted rerun results for this test-only correction must be verified separately.

## CI dependency repair — 2026-10-22

Hosted run `39779366661` for `e349399` failed the source dependency gate on CRITICAL `CVE-2026-114125` in Storybook 10.6.0. The root/web/Backoffice/UI Storybook pins and resolved packages are updated together to 10.6.2, the upstream patched release. No exception or security policy change is introduced. The failure report is retained under `artifacts/backoffice/ci-39779366661/`; see the [security repair record](../../security/README.md#2026-10-22-storybook-ci-repair).

Local verification passed: frozen install, current Trivy 0.69.3 dependency scan with zero blocking findings, source/type/Knip checks, 186 unit tests and Storybook build. Hosted rerun results remain to be verified on the new commit; this record does not label pending jobs successful.

## Shared UI revision — 2026-10-22

The staff workspace now uses shared UI cards, badges, live notices, buttons, inputs and language selection, with the Foundation theme and responsive dashboard styling. Backoffice owns its presentation and catalogs; it does not instantiate customer identity or configuration. No service permissions, schemas or operator models changed in this UI revision.

| Check | Result |
| --- | --- |
| Frozen Bun install, source, typecheck and Knip | Passed; four existing informational Biome suggestions remain in public-request tests |
| Unit suite | 186 passed across 36 files, including catalog/theme checks |
| Backoffice and customer production builds | Both passed |
| Storybook build | Passed; empty, pending, denied, organization result, Spanish and dark Backoffice states included |
| HTTPS Backoffice browser journey | Passed: shared component CSS, keyboard/field validation, passkey enrollment/sign-in, cookie isolation, pending state, audited scoped lookup, unauthorized lookup, sign-out, Spanish mobile layout and dark selector contrast; no browser errors |
| Running development app | Direct localhost:3001 returned the new UI; Chromium verified the styled controls and no page errors after restarting the dev server |

Desktop light/dark and Spanish mobile screenshots were visually reviewed. Logs/screenshots and a source receipt are retained in `artifacts/backoffice/ui-2026-10-22/`. This UI revision did not rebuild/retest images or rerun vulnerability scans, the full customer browser/integration suite or load/hosted release gates. Image evidence in the sections below belongs to its recorded source. Production release acceptance remains pending.

## Public access revision — 2026-10-22

Implemented the user-approved removal of custom proxy signatures and IP allowlists. Ordinary unsigned requests reach staff sign-in; passkeys, exact host/origin checks, isolated sessions, scoped grants, independent recovery epochs and audit-before-disclosure remain enforced. Cloudflare deployment is outside scope. No schema/model/history changes were made. The source-derived rate key is replaced with a single durable 60/minute protected-request budget shared by all callers and replicas; changing source headers cannot evade it, but one caller can temporarily consume the shared budget.

| Check | Result |
| --- | --- |
| `bun run check`, `bun run typecheck`, `bun run knip` | Passed; Biome reports four informational template-literal suggestions in tests |
| `bun run test:unit` | 186 passed across 36 files |
| `bun run test:integration packages/backoffice` | 8 passed: unsigned scoped lookup/audit, origin/customer/bearer denial, durable rate exhaustion/reset, grants/FGA/audit failures, offboarding and restore |
| `bun run build:backoffice` | Passed |
| `bun run test:e2e:backoffice` | 1 HTTPS test passed without signature injection: enrollment, passkey sign-in, cookie isolation, scoped lookup/denial, sign-out and Spanish state |
| `bun run image:build:backoffice`, `bun run test:image:backoffice` | Passed on arm64: public sign-in and unauthenticated lookup denial, restricted runtime/contents, readiness and graceful stop |

Revision base: `532b49a782eaaa2f0a2ade60409af9e057c68794` plus working-tree changes. Source fingerprint: `b5fe015a381b2c176b0f6bfcbf95f554216ce8d2951557f1cfb143b9f5b2fb3b`. Tested Backoffice image: `sha256:1f0615dca49d5ed473be97eb34e7e14e0963e02e9727d7f4414bbf5eafac90bd`. Logs and image receipt are retained under `artifacts/backoffice/public-access-2026-10-22/`.

An initial typecheck found a missing `NODE_ENV` in the new configuration test fixture; it was fixed and the final typecheck passed. This revision did not rerun the full customer integration/browser suite, customer image, vulnerability scans, concurrent-load tests or hosted CI. Earlier results below are historical evidence for their recorded source, not acceptance of this revision. Full release gates remain open.

## Historical local validation — resumed 2026-10-21

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

## Historical source and image pair — 2026-10-21

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

The original validation blockers and the targeted public-access checks above are closed. Remaining release work is separate:

1. Run the required hosted CI/release jobs on the committed source and intended deployment architecture. Preserve the source/image bindings and vulnerability policy; local arm64 evidence does not claim hosted amd64 success.
2. Complete the due operator/customer concurrent workload and broader compatibility/outage evidence. The historical Foundation performance result does not cover operator load; the current exact-image pair and BO-omitted customer checks do not prove every upgrade/blackhole scenario.
3. Complete independent BO-00 deployment/security review: staff cohort/scopes, verification and signing custodians, local-passkey policy or mandatory SSO, staff recovery and audit retention. Review migration/runtime role blast radius and the supported schema/model pair.
4. Review/accept only the due scoped `R-BO-*` gates in the roadmap. Full directory search, later modules and their acceptance remain open.
