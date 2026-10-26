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

### Run the Backoffice locally

The optional Backoffice is a separate Next.js staff application in `apps/backoffice`, with its own identity, sessions and authorization model. Invited staff can browse their assigned organizations and read audited organization metadata, including lifecycle and seat usage. Customer accounts and organization roles do not grant staff access. It has no separate worker and can run alongside the customer app on port 3001.

The `.env` copied during local setup already contains the Backoffice settings as comments. Uncomment the five Backoffice runtime settings and replace `BACKOFFICE_AUTH_SECRET` with a new independent secret of at least 32 characters, for example generated with `openssl rand -hex 32`. Do not reuse `AUTH_SECRET`. The other supplied values work with the default local services; change the origin or database URLs only if your local host, port or database targets differ. Leave management-only settings commented out until setting up staff invitations. Disposable Compose setup provisions the restricted Backoffice database roles.

With services running, apply the current migrations, initialize the control schema extension and publish the separate staff authorization model:

```sh
bun run db:migrate
bun run control:schema
bun run backoffice:publish
bun run dev:backoffice
```

Run these commands from the repository root. Schema/publication commands use the dedicated `MIGRATION_DATABASE_URL` and `CONTROL_ADMIN_DATABASE_URL` from local setup. Production Backoffice processes require only their restricted runtime configuration; management, migration, recovery and control-administrator credentials belong to their separate commands.

Open [Backoffice](http://localhost:3001/en). Use `localhost` consistently with `BACKOFFICE_ORIGIN`; host/origin checks also apply locally. Loopback HTTP is supported for development. The customer web app and worker do not need to be running for the staff sign-in page, but PostgreSQL, the control database and OpenFGA are required for readiness and staff access.

There is no default staff account or public staff registration. Enrollment requires an invitation created by `bun run backoffice:manage APPROVAL_FILE PRIVATE_OUTPUT_FILE`, with two independent Ed25519 approvals and exact organization grants. Staff then enroll a user-verified passkey. See [independent staff management](docs/backoffice/implementation.md#independent-staff-management) for approval claims, command-only configuration and invitation handling; customer registration and Mailpit do not create staff access.

To check startup:

```sh
curl -i http://localhost:3001/health/live
curl -i http://localhost:3001/health/ready
```

Liveness reports whether the server can respond. Readiness additionally checks restricted roles, the application schema and installation binding, customer and staff authorization publications, and OpenFGA. A rendered sign-in page or successful liveness check does not establish readiness. `503 {"status":"unavailable"}` means one of those prerequisites failed; the HTTP response intentionally omits infrastructure details.

For a fresh or reset disposable database, complete `services:up`, `db:migrate` and `bootstrap` before the Backoffice setup commands. An empty control store causes `Independent authorization readiness required`; missing application migrations also block readiness. If initialized data was expected, check database targets and `INSTALLATION_ID` first. Existing or restored installations require the documented [upgrade](docs/phase3/README.md) or [recovery](docs/phase6/recovery.md) workflow, rather than fresh initialization. After a Compose data reset, staff invitations and passkeys must also be set up again.

The [Backoffice implementation guide](docs/backoffice/implementation.md) covers schema compatibility, signed management and the separate production image. [Acceptance evidence](docs/backoffice/acceptance.md) tracks completed checks and remaining release gates.

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
