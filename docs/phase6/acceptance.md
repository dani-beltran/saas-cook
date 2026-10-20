# Phase 6 implementation and verification

Date: 2026-10-19. This completion change is stacked on PR #4, `codex/phase6-platform-modules` at `e8827f78deb6f2b01d741868507adce4b94361e7`. The [original PR #4 record](acceptance-pr4.md) is preserved as historical evidence. Its “remaining work” table describes that earlier snapshot, not this implementation.

## Implemented scope

| Requirement | Completion implementation and verification |
| --- | --- |
| R-FILES | Mapped CSV dry run/duplicates, bounded import chunks with stable per-row receipts, immutable encrypted exports, current session/resource download checks, retry/cancel/expiry and quota release. Real worker-role tests and browser import/export use PostgreSQL, OpenFGA and S3. |
| R-ACCOUNT | Fresh-auth own-account export/ownership preview, accepted succession evidence, multi-org identity freeze, credential removal, shared seat/grant transitions, continuing tenant preservation, resumable journaled cleanup and receipt-only status. |
| R-ORG-DATA | Scoped organization JSON export, owner-only confirmation, pre-confirmation cancellation, independent scheduling acknowledgement, per-store cleanup and separate provider/backup status. Files wait out issued upload URLs before removal. |
| R-RECOVERY | Independently retained hash-chain journal/checkpoints; signed fresh-MFA approvals; fresh epoch/model; restored credentials and direct/team authority invalidated; independently verified identity enrollment; surviving owners require recovery. Real full pg_dump/pg_restore drill includes newer revocation, accepted transfer and account/org deletion, interrupted replay and denied old authority. |
| R-ANALYTICS | Typed committed source catalogue, opaque attribution, authoritative user/org preferences, bounded delivery, operator cohort reports, tested PostHog protocol adapter, independent post-backup subject/attempt registry, suppression and late-ingestion erasure barrier. |
| Notifications/settings | In-app/optional email preferences and Mailpit delivery, unsubscribe/feedback suppression, encrypted webhook/integration credentials, verification/rotation/retry/health, SSRF-resistant public HTTPS transport and versioned expiring rollout flags. |
| Audit/help/public UI | Dedicated owner-granted audit authorization, bounded query/export, localized data/settings/privacy/receipt/help/about flows. |
| R-SEARCH / R-ACTIVITY / R-KEYS | PR #4 implementation remains the base; regression suites cover current permission and lifecycle behavior. |

See [completion scope and limits](completion.md), [analytics protocol/report definitions](analytics.md), [recovery runbook](recovery.md), [file formats](files.md) and [feature brief](../../feature-briefs/phase6-completion.md). Migrations `0016`–`0024` and their snapshots are additive; applied history through `0015` is unchanged. No production database, live mail recipient or live provider was modified.

## Executed verification at the original completion commit

These results belong to `75d327905a08b8a82662dda6fe7bfa720ab09d01`. Its [hosted CI run](https://github.com/dani-beltran/saas-cook/actions/runs/39328558040) subsequently passed all nine jobs, including the final required gate. The translation follow-up has its own evidence below.

- Source formatting, strict root/web types, Knip and all four static skill/migration/API boundary checks pass.
- Full unit suite: **168/168** across 29 files.
- Lifecycle/analytics hardening: **13/13** across five files, including real full backup restore and S3 pending-upload cleanup.
- Bulk integration under the actual restricted worker database role: **3/3**.
- Full browser suite: **49/49**. The completion journey uses real sessions and the built worker: CSV import, generated export download, audit grant/query, organization/personal preferences, sole-owner protection, prepared-deletion cancellation, and Spanish mobile/dark settings and public/help pages.
- Production web/worker/command build and Storybook pass. Current dependency vulnerability policy passes with pinned Trivy 0.69.3 and a freshly downloaded database, without new exceptions.
- Recovery receipt regression: **11/11** across five lifecycle/API files, including receipt access after a real application backup restore.
- Full skill-boundary check: **6/6**, including negative controls and real-service boundaries.
- Final combined image: **17/17** checks, including all 15 packaged commands, real session/worker/S3 export and journaled deletion; current exact-image vulnerability policy passes with no blocking findings.
- Final-source authorization smoke: **3,171/3,171** operations, zero failures/retries and stable source fingerprint. This 15-second measurement is not the full `R-AUTHZ-PERF` gate.
- Clean full integration suite: **215/215** across 37 files, including current restricted roles, fresh/upgrade migrations, real PostgreSQL/OpenFGA/S3 and the full backup-restore drill.

The [machine-readable completion record](evidence/completion.json) binds the results to the final implementation and image hashes. Diagnostics remain under ignored `artifacts/phase6-completion/` with test reports in the normal `artifacts/` locations. Early failed runs are retained: obsolete migration count/table assumptions, cached modules during an earlier full run, missing form submit types, an omitted restricted-worker quota INSERT grant and immediate checkbox assertions before asynchronous saves. These were repaired and rerun. Image fixtures initially lacked the signed ingress headers; an older disposable control database also lacked CONNECT for the newly added journal writer, which correctly left deletion pending. Both were corrected before the final image pass. Parallel browser mail capture now uses a fixture-only lock to prevent tests consuming each other’s verification tokens. An initial scanner attempt could not find Trivy on PATH; the pinned existing binary completed the policy. The first authorization smoke had 2,530/2,530 successful operations but invalid evidence because generated source changed during measurement; it does not count as a passing benchmark.

## Acceptance limits

Implementation is distinct from accepting M2. PostHog tests use an explicit protocol fixture and late-write/deletion fault scenarios; no live PostHog account was configured. The adapter keeps ambiguous ingestion or unverified erasure pending. A release must validate its provider's query/deletion completion behavior and retain independent journal/analytics receipts across all restorable backups. Existing Phase 5 Stripe test evidence is historical; this change uses provider contract fixtures and does not claim a new live cancellation drill.

The restore drill proves the application protocol with disposable PostgreSQL/OpenFGA/S3 services. It does not establish infrastructure recovery time, backup retention expiry, old-process isolation or a live provider's guarantees. No new full 30-minute authorization performance gate or live-agent Commercial skill behavior evaluation is claimed. Phase 6/M2 release acceptance remains open for those applicable release-evidence gates; this record does not label them optional or passed.

## Translation follow-up — 2026-10-20

All Phase 6 pages and shared components now use next-intl, including the predecessor search, activity, file and API-key surfaces. Per-locale JSON catalogs contain the copy; server requests, the client provider and Storybook share catalog composition. Supported locales and request fallback are centralized. Counts and row/status summaries use ICU messages.

Biome, strict root/web types, Knip, all four static boundary checks, **172 unit tests across 30 files**, production build and Storybook build pass. Translation tests check matching keys/placeholders, format every registered message, and verify singular/plural and row interpolation. **Six browser tests pass** across completion (three), platform (two) and files (one), exercising real sessions/worker/S3 plus English/Spanish public server pages, receipt errors, Spanish data/preferences and existing authorization flows.

The [localization evidence](evidence/localization.json) records this source fingerprint and the executed checks. Earlier implementation/integration/image results above remain tied to their original source; this UI follow-up does not re-label them as new local runs. Logs remain under ignored `artifacts/phase6-completion/localization/`.
