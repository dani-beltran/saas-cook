# common-sass

A reusable SaaS template designed to give you a foundation to build your own SaaS product on. It brings together the platform features that SaaS products commonly need, so you can focus on your product’s domain, workflows, and customer experience.

The planned foundation uses **Next.js, React 19, TypeScript, shadcn/ui, Tailwind CSS, Better Auth, Drizzle ORM, PostgreSQL, and oRPC**, with **Bun** for package management and **Stripe** for payments and billing. It covers authentication with email/password registration and reset, magic links, passkeys and MFA recovery, organizations and tenant isolation, relationship-based permissions, a dashboard, background jobs, and AI agent skills for building and evolving product features. Commercial and enterprise modules add subscriptions, usage tracking, product analytics, personal account deletion with organization ownership transfer, integrations, SSO, and administration.

The [required stack](docs/02-architecture-and-security.md#21-stack-decisions) also includes next-intl, React Email, Zod, React Hook Form, Vitest, Playwright, Storybook, Biome, Commitlint, Lefthook, Knip, T3 Env, GitHub Actions, LogTape, and `AGENTS.md` for AI coding context.

The template is intended to be source code you own and customize. You supply your product-specific features, business rules, branding, and pricing.

The template will build one Docker image containing the web app and background worker, with external data services configured at runtime.

**Status:** Phase 2 identity and tenancy primitives are implemented: email/passkey/MFA sign-in, organizations, memberships, invitations, teams, tenant RLS, local seats, contextual OpenFGA authorization, ownership transfer and signed owner-recovery commands. See the [identity and tenancy setup guide](docs/phase2/README.md). Phase 3 adds Projects, optional workspaces, resource grants, service accounts/API keys and local capacity. Functional checks passed; sustained performance acceptance remains pending a corrected parent-change benchmark. See the [Phase 3 setup and upgrade guide](docs/phase3/README.md) and [acceptance record](docs/phase3/acceptance.md).

## Local development

Phase 4 adds six [repository-local AI skills](docs/development/agent-skills.md), [feature briefs](feature-briefs/phase4-project-task.md), deterministic migration/RLS/API checks, and an isolated behavior evaluation runner. Start with the [Phase 4 guide](docs/phase4/README.md); its [acceptance record](docs/phase4/acceptance.md) distinguishes executed evidence from pending gates. The missing Phase 3 benchmark is excluded from this implementation request.

With Node.js 24.19.0, Bun 1.4.2 and Docker installed:

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run services:up
bun run db:migrate
bun run bootstrap
bun run dev
```

### Create your first account

A fresh installation has no pre-created account. To create an account and start using the platform:

1. Open the [account page](http://localhost:3000/en/account).
2. Enter a synthetic test email such as `my-name@example.test` and your name, then click **Create account**.
3. Open [Mailpit](http://localhost:8026), which captures local development emails instead of sending them to a real inbox.
4. Find the message addressed to your test email with the subject **Verify your email address**, follow its link, and explicitly confirm on the page that opens.
5. Once signed in, create an organization from the account page.

Password authentication is disabled. For subsequent sign-ins, enter your registered email and click **Email a sign-in link**, then check Mailpit and confirm the link. You can also enroll a passkey from your account.

Local services use disposable synthetic credentials. See the [runtime guide](docs/phase2/README.md) for tests, stories, image commands and implementation boundaries.

Local service data is stored in memory and is lost when the containers stop or are recreated, including registered accounts. After a reset, repeat `services:up`, `db:migrate` and `bootstrap` before `dev`, then register again. Keep the database targets in `.env` consistent with `.env.example`; Compose creates `common_saas` and `common_saas_control`, not temporary test databases. See [startup troubleshooting](docs/phase2/README.md#local-startup-troubleshooting) for worker failures.

## Planning and design

New to the project? Read the [junior developer guide](docs/08-junior-developer-guide.md) for a plain-language explanation of the project, planned features, architecture, current status, and implementation phases.

Start with the [project overview](docs/00-project-overview.md) for the original planning summary and an index of the documentation in [`docs/`](docs/). It explains the proposed foundation, delivery boundaries, and required design gates.

The documentation details the [product plan](docs/01-product-plan.md), [architecture and security design](docs/02-architecture-and-security.md), data model, billing and operations, [AI agent skills](docs/05-ai-agent-skills.md), [delivery roadmap](docs/06-delivery-roadmap.md), and [Docker image build plan](docs/07-ci-and-docker-image.md).
