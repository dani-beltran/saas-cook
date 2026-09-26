# Phase 1 acceptance record

Date: 2026-09-26. Preset: Foundation runtime and synthetic fixtures. Suite: Phase 1, version 1. No commercial providers or identity/tenant endpoints enabled.

**Result: Phase 1 local acceptance passed.** Machine-readable [verification results](evidence/verification.json), [image acceptance](evidence/image-acceptance.json), [authorization model assertions](evidence/authorization-model.json) and [security summaries](evidence/security.json) are retained here. Complete reports are generated under ignored `artifacts/` and uploaded by CI.

| Gate | Executed result |
| --- | --- |
| Frozen install | Clean source snapshot installed with Bun 1.4.2; lockfile unchanged; source-only strict typecheck passed without generated Next files |
| Source quality | Biome, TypeScript and Knip passed; generated Lefthook hooks accepted valid source/commits and rejected invalid source/messages in a disposable repository |
| Unit | 33 passed, none failed or skipped |
| Integration | 6 passed against real services: fresh/replay/upgrade migrations, restricted roles, durable worker receipts, abandoned-job recovery, trace correlation, S3 round-trips and mail/FGA connectivity |
| Browser | 3 Chromium tests passed against the production standalone server, including locale/theme, form errors/focus, organization reset, mobile keyboard/layout and real public API contracts |
| Builds | Next.js production/standalone and Storybook builds passed; 6 shared locale/theme/form stories; desktop/mobile screenshots reviewed |
| Authorization model setup | Real OpenFGA accepted the selected model and passed 4 contextual assertions; no production authorization claim |
| `R-IMAGE` Phase 1 | 11 acceptance checks passed on Linux arm64: commands, config rejection, migration replay, native Sharp compatibility, static/public assets, health, credential separation, stale heartbeat, graceful shutdown and both child failures |
| Security | Final dependency graph including dev/test dependencies and exact final application image both passed with zero HIGH/CRITICAL findings; no exceptions |

The tested image is `common-sass:phase1`, ID `sha256:83a4bcde9642a2ffcdf7e0663a1219d00b2e59f3d68a00404b58fc0f6f7f2fcc`. Its implementation fingerprint is `91d309a86c78bf173121d19cab5935cd1d468b8fe18510616ab894a26d45280e`. The source was an uncommitted working tree based on `0caf2ca38bcdbf6b574333e964ac2dd194709e29`; the fingerprint binds the image to the tested implementation instead of claiming that the base commit contains these changes.

The build used Node 24.19.0/Bun 1.4.2; the final digest-pinned distroless runtime is Node 24.21.0. The initial Debian 12 slim image was rejected after its vulnerability scan; no exception was added. The final image contains no shell or package installer and passed the actual native-library and application checks.

GitHub Actions jobs are configured and their source/scripts validated, but hosted CI has not run. Linux amd64 is configured for CI and is not claimed as locally tested. The historical Phase 0 unit suite also passed 79 tests; its 52 integration tests were intentionally disabled in that separate historical run and are not counted as Phase 1 acceptance.

Phase 2 `R-IMAGE` initialization/publication/readiness, identity journeys, tenant isolation and production authorization are explicitly excluded. Bootstrap/model command help and refusal are packaging checks, not passed Phase 2 behavior.
