# Vulnerability gate

`bun run security:scan dependencies` scans the committed dependency graph. `bun run security:scan image <tag-or-digest>` scans the exact locally built application image. Install Trivy 0.69.3 locally, or set `TRIVY_BIN` to its executable. CI downloads the Linux amd64 executable using a checked-in SHA-256, then downloads current vulnerability databases. Scanner errors and absent scan results fail closed.

Every HIGH or CRITICAL finding blocks CI, including findings with no fix available. The full JSON scan and the policy decision are retained under `artifacts/security`. Lower-severity findings remain visible in the full report.

`exceptions.json` starts empty. Any exception needs a separate reviewed change with the exact vulnerability ID, package, installed version, report target and scan scope (`dependencies` or `image`), plus an accountable owner, review URL, concrete mitigation reason and expiry date. Wildcard matching is unsupported. Expired exceptions fail the gate, even if the finding disappears, so obsolete entries must be removed. Expiries may be at most 90 days away; reviewers should use the shortest practical period. Do not weaken the severity gate or create exceptions just to make an implementation pass.

CI uses Trivy's [immutable 0.69.3 release](https://github.com/aquasecurity/trivy/releases/tag/v0.69.3). The checksum was retrieved from the [official release checksum file](https://github.com/aquasecurity/trivy/releases/download/v0.69.3/trivy_0.69.3_checksums.txt) on 2026-09-26. This version is identified as protected by immutable releases in the [upstream supply-chain incident advisory](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23). Upgrading the scanner requires reviewing that advisory, upstream release provenance and the new checksum together.

GitHub Action pins were resolved from the upstream GitHub tag-ref API on 2026-09-26: checkout v7.0.1, setup-node v7.0.0, upload-artifact v7.0.1, setup-bun v2.2.0 and cache v4.2.3. The workflow executes no floating Action tags and uses read-only repository permissions. Protect `main` with the `required` job and review changes to the workflow and this exception policy.

## 2026-10-19 dependency refresh

PR #2's first hosted scan blocked on 13 dependency findings and five image
findings. Next.js is pinned to 16.3.8 and Sharp to 0.35.5. Exact root overrides
select Axios 1.20.0 (the OpenFGA SDK still declares 1.19.0) and source-map-js
1.2.2. Keep those overrides until upstream dependency constraints select safe
versions; verify OpenFGA integration and the production build when changing them.

The unused shadcn CLI was removed from the installed toolchain because its
fast-glob/micromatch chain requires braces 3.0.3, which has no published fix for
CVE-2026-93687. This also removes the CLI's affected MCP SDK dependency. Existing
checked-in UI primitives need no CLI at runtime. Historical Phase 0 evidence is
retained; the toolchain probe now checks the currently installed CLI set.

The distroless runtime digest was refreshed to
`sha256:59c479c9b8c123e66047315c968aa2d35e31ae5149c856e4110a79c8b3563f0b`
with OpenSSL 3.5.7-1~deb13u3 and Node.js 24.22.0 to address the image's
OpenSSL finding. Image acceptance asserts that exact Node version. These changes do not waive any findings:
the unchanged dependency and image gates must scan the updated graph and image
with current vulnerability data before release acceptance.

## 2026-10-21 CI dependency repair

PR #5's dependency scan blocked on three HIGH findings in `bun.lock`:
`CVE-2026-111755` and `CVE-2026-111756` in `follow-redirects` 1.16.0, and
`CVE-2026-112942` in Vite 8.3.0. The exact `follow-redirects` override selects
1.16.1 for Axios's compatible range. See the upstream
[sensitive-header escaping advisory](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-8r9p-f939-6h3c)
and [array-header advisory](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-q3jh-wrc6-jgq8).

Vite is explicitly pinned as a root development dependency at 8.3.3, the patched
release identified by the upstream
[editor-path advisory](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm).
Vitest and Storybook require Vite as a peer. An override alone left Bun's
previously resolved peer at 8.3.0; the explicit dependency updates the actual
installed and locked graph. Keep this peer pin when maintaining those tools.
The scanner version, severity policy and empty exception list are unchanged.

## 2026-10-22 Storybook security repair

The current dependency scan blocks `storybook` 10.6.0 on critical
`CVE-2026-114125` / [GHSA-f2ph-cmg5-wxc8](https://github.com/storybookjs/storybook/security/advisories/GHSA-f2ph-cmg5-wxc8).
Root, web and UI workspace pins now align `storybook` and `@storybook/nextjs-vite`
on the patched 10.6.2 release; Bun's reviewed lockfile retains a single aligned
Storybook toolchain. The original failing scan is retained under
`artifacts/phase6-erasure-verification/security-failure-1/`. Frozen installation,
Storybook build and current dependency/image policy are checked again. No severity
policy or exception changes are made.
