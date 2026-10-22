# SaaS Cook

A reusable SaaS template for building subscription products with authentication, organizations, permissions, billing and background processing. You own the source and customize the branding, pricing, business rules and product features.

Built with **Next.js, React 19, TypeScript, shadcn/ui, Tailwind CSS, Better Auth, Drizzle ORM, PostgreSQL and oRPC**. **Bun** manages the workspace; **Node.js** runs development tools and the application.

The stack also includes next-intl, React Email, Zod, React Hook Form, Vitest, Playwright, Storybook, Biome, Commitlint, Lefthook, Knip, T3 Env, GitHub Actions, LogTape, and `AGENTS.md` for AI coding context.

## What's included

- Email/password registration and reset, magic links, passkeys, multi-factor authentication and account recovery.
- Organizations, invitations, teams, tenant isolation, relationship-based permissions, service accounts and API keys.
- A localized dashboard and reference Project feature, shared UI components, forms and Storybook.
- Optional Stripe subscriptions and seat billing, a usage ledger and quota enforcement.
- Private files, imports/exports, search, activity feeds, notifications, webhooks, integrations and analytics controls.
- Account and organization deletion, recovery controls, audit records and background jobs.
- Repository-local AI coding skills for building, evolving and verifying features.

See [module availability](docs/development/module-availability.md) for supported capabilities, configuration requirements and limitations. The customer web app and worker ship in one Docker image, with external services configured at runtime. An optional [Backoffice application](docs/backoffice/implementation.md) provides a separate staff interface and image.

## Local development

Install **Node.js 24.19.0**, **Bun 1.4.2** and **Docker**, then run these commands from the repository root:

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run services:up
bun run db:migrate
bun run bootstrap
bun run dev
```

Use disposable synthetic credentials with the local services. The [runtime guide](docs/phase2/README.md) documents configuration, commands and troubleshooting.

### Create your first account

A fresh installation has no pre-created account:

1. Open the [account page](http://localhost:3000/en/account).
2. Choose **Create account**, enter your name, a synthetic test email such as `my-name@example.test`, and a password with its confirmation, then submit the registration form.
3. Open [Mailpit](http://localhost:8026), which captures local development emails instead of sending them to a real inbox.
4. Find the message addressed to your test email with the subject **Verify your email address**, follow its link, and explicitly confirm on the page that opens.
5. Once signed in, create an organization from the account page.

For subsequent sign-ins, use your verified email and password. Email sign-in links and enrolled passkeys are also supported; email links are captured in Mailpit and require explicit confirmation. You can enroll a passkey or authenticator from your account.

Local service data is stored in memory and is lost when the containers stop or are recreated, including registered accounts. After a reset, repeat `services:up`, `db:migrate` and `bootstrap` before `dev`, then register again. Keep the database targets in `.env` consistent with `.env.example`; Compose creates `saas_cook` and `saas_cook_control`, not temporary test databases. See [startup troubleshooting](docs/phase2/README.md#local-startup-troubleshooting) for worker failures.

## Customize the template

Start with the [feature workflow](docs/development/feature-workflow.md) to understand where schema, services, API contracts, dashboard views and translations belong. Follow the [theming guide](docs/development/theming.md) to change the product's appearance and the [email guide](docs/development/email-workflow.md) for transactional messages.

The root package is `saas-cook`, and workspace packages use `@saas-cook`. Repository-local [AI coding skills](docs/development/agent-skills.md) support adopting or renaming the template and adding or changing features. Record product decisions in [feature briefs](docs/feature-briefs/). The [compatibility notes](docs/00-project-overview.md#compatibility-identifiers) explain retained identifiers to consider when renaming.

## Contributing

Read [AGENTS.md](AGENTS.md) for repository conventions, supported commands and security boundaries. The [developer introduction](docs/08-junior-developer-guide.md), [architecture and security design](docs/02-architecture-and-security.md) and [data model](docs/03-data-model.md) explain how the project fits together. Use the [feature workflow](docs/development/feature-workflow.md), [migration instructions](packages/db/migrations/README.md) and [verification guide](docs/development/verification.md) when making changes.

Common commands:

| Task | Command |
| --- | --- |
| Source and formatting checks | `bun run check` |
| Type checks | `bun run typecheck` |
| Unit tests | `bun run test:unit` |
| Integration tests with local services running | `bun run test:integration` |
| Component development | `bun run storybook` |
| Production build | `bun run build` |

Run checks appropriate to the change; the verification guide describes browser, migration, security and image checks. Use Conventional Commits with headers of at most 100 characters, including PR titles. You can install local Git hooks with `bun run hooks:install`; CI enforces the repository policies independently.

For planning, development history and acceptance evidence, consult the [delivery roadmap](docs/06-delivery-roadmap.md). The [documentation overview](docs/00-project-overview.md) links to the broader product and operations documents, and the [image guide](docs/07-ci-and-docker-image.md) covers packaging and verification.
