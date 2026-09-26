---
name: saas-bootstrap
description: Start or rename a product from this repository, choose implemented modules, and verify disposable local setup. Use for template adoption and interrupted setup, not production provisioning.
---

# Bootstrap a product

Read [AGENTS.md](../../../AGENTS.md), the [development map](../../../docs/development/feature-workflow.md), and [module availability](../../../docs/development/module-availability.md). Inspect the working tree, package/import names, `.env.example` and prior setup evidence before editing. Use the current checkout as the source of truth.

Record product name, package namespace, locale, enabled Foundation modules and synthetic fixture identities in a concise Markdown brief under `feature-briefs/`. The [bootstrap brief](../../../feature-briefs/phase4-bootstrap.md) is an example, not a required name or a configuration language. Infer routine defaults; clarify consequential product rules. A Markdown manifest documents decisions; it does not activate modules.

For a rename, inventory active manifests, workspace imports, branding defaults, metadata, UI/email copy, examples, build configuration and image references. This repository uses both `common-sass` and `@common-saas`; inspect their meaning before replacement. Preserve migration/model history, data, custom source and historical `spikes/phase0` / `docs/phase0` evidence. Do not implicitly rename database roles, migration identities or an existing installation. Update active examples deliberately and record intentional legacy identifiers. Keep `bun.lock` consistent using pinned Bun; never replace its format.

Use Bun 1.4.2 for install/root scripts and Node 24.19.0 locally. Preserve an existing `.env`; create it from `.env.example` only if absent, using synthetic credentials for disposable services. Actual setup commands are `bun install --frozen-lockfile`, `bun run services:up`, `bun run db:migrate`, `bun run bootstrap` and `bun run dev`. Read [Phase 3 setup](../../../docs/phase3/README.md#running-and-upgrading) before initialization: existing ready installations use the reviewed upgrade path; restored/recovery-required state is not fresh. There is no root `db:seed`; use existing fixtures or add a scoped fixture as ordinary source.

Verify app/worker readiness, localized branding, synthetic sign-in and an authorized organization journey. Follow [verification](../../../docs/development/verification.md). Record commands, outcomes, remaining setup and module limitations. On resume, inspect processes, migration/readiness state and earlier evidence; never repeat initialization or other effects solely because a prior response ended. Repeating satisfied setup should add no duplicate manifest, fixture, migration or registration.

This skill authorizes no deployment, production migration, live notification or commercial change. Follow authorization already in the task; local setup requires no redundant confirmation merely because this skill is loaded.
