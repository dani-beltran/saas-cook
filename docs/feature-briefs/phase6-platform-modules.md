# Remaining Phase 6 platform modules

Base: PR #4 (`e8827f78deb6f2b01d741868507adce4b94361e7`). This change targets that branch.

Implement the remaining roadmap requirements without treating partial implementation as acceptance:

- R-ACCOUNT / R-ORG-DATA / R-RECOVERY: separately durable, append-only, verified deletion journal; pending acknowledgement, ownership continuity, frozen identities, bounded resumable per-store cleanup; honest provider and backup status. Recovery closes readiness, rotates epochs, replays a verified watermark and requires independently signed current evidence and replacement credentials after an application restore. Restored grants never self-approve. FGA-only recovery requires independent intact-application attestation.
- R-FILES: bounded CSV mapping, validation/dry run, explicit duplicate rules, chunk receipts and current authorization; asynchronous encrypted exports with expiry, current download checks and formula-safe CSV.
- R-ANALYTICS: authoritative user and organization preferences; versioned minimal events; isolated bounded delivery; opaque identifiers; documented cohort reports; suppression and in-flight delivery/deletion barriers.
- Notifications/preferences, signed outgoing webhooks with endpoint verification and rotation, encrypted integration credentials, deterministic expiring rollout flags, dedicated audit access/export, contextual help and public pages.

Human endpoints reject bearer principals. Organization management requires current policy decisions; personal operations are own-account only. Background jobs recheck actor, lifecycle and epoch before effects. DTOs never expose stored secrets, arbitrary audit payloads, or other users' private data. Optional providers default off and failure cannot grant access or imply successful cleanup.

Application migration history through 0015 remains unchanged. New tables have matching Drizzle snapshots, forced RLS where tenant-owned, scoped constraints and restricted grants. Control data has separate credentials and backup lifetime; application/runtime reader cannot mutate readiness or journal history. Retain financial/security records under explicit restricted retention and report them separately from purged content.

Verification requires real PostgreSQL/OpenFGA/S3 fixtures, current permissions, race/replay/interruption faults, provider protocol tests, localized browser journeys, production and Storybook builds, image tests and current security scans. Record executed results and unresolved gates in docs/phase6; no current completion claim.

## Implemented decisions

The bounded provider/format scope, role-separated opt-in runtime, command upgrade, deletion cancellation boundary, retained categories, job limits and public UI are documented in [platform modules](../phase6/platform-modules.md). [Recovery](../phase6/recovery.md) specifies independent approval and enrollment; [analytics](../phase6/analytics.md) specifies the catalogue, reports and pending-erasure behavior. The [verification record](../phase6/acceptance.md) separates executed application checks from provider/infrastructure and release-evaluation evidence.

Phase 6 UI copy uses feature-owned next-intl namespaces in per-locale, per-feature JSON catalogs. Server pages use `getTranslations`; client components use `useTranslations`. The request, layout and Storybook share catalog composition and the supported-locale definition. User-visible counts and interpolated messages use ICU; catalog tests check key/placeholder parity and formatting for every registered locale.

The delivery-task label `completion` is retired from executable feature names. The supported ownership and unreleased RPC rename are documented in [platform modules](../phase6/platform-modules.md#feature-ownership-and-api-compatibility). Notification preferences and unsubscribe are separate from privacy/deletion; About and Help compose a shared public-page shell. REST contracts, browser routes and stored state remain compatible.

Shared browser-safe Zod inputs in `packages/api-contracts/src/inputs` own UUID syntax, bulk job field combinations, endpoint/integration inputs, deletion key/receipt syntax and analytics preference values. Contracts compose route context with those inputs and services validate independently. Invalid combinations previously rejected inside services now fail API validation with 422. Browser file metadata, search and key forms reuse contract constraints. Authorization, current versions, scoped replay, network/cryptographic verification and database invariants remain service-owned; migration history and valid request/response shapes are preserved.
