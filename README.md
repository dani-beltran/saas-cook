# common-sass

A reusable SaaS template designed to give you a foundation to build your own SaaS product on. It brings together the platform features that SaaS products commonly need, so you can focus on your product’s domain, workflows, and customer experience.

The planned foundation uses **Next.js, React 19, TypeScript, shadcn/ui, Tailwind CSS, Better Auth, Drizzle ORM, PostgreSQL, and oRPC**, with **Bun** for package management and **Stripe** for payments and billing. It covers authentication with email magic links and passkeys, organizations and tenant isolation, relationship-based permissions, a dashboard, background jobs, and AI agent skills for building and evolving product features. Commercial and enterprise modules add subscriptions, usage tracking, product analytics, personal account deletion with organization ownership transfer, integrations, SSO, and administration.

The [required stack](docs/02-architecture-and-security.md#21-stack-decisions) also includes next-intl, React Email, Zod, React Hook Form, Vitest, Playwright, Storybook, Biome, Commitlint, Lefthook, Knip, T3 Env, GitHub Actions, LogTape, and `AGENTS.md` for AI coding context.

The template is intended to be source code you own and customize. You supply your product-specific features, business rules, branding, and pricing.

The default deployment runs the web app and background worker together in one Docker container, connected to external data services. Kubernetes deployment is optional.

**Status:** planning only. This repository currently contains the project plan and architecture and design specifications. The application, agent skills, and tooling have not yet been implemented.

## Planning and design

Start with the [project overview](docs/00-project-overview.md) for the original planning summary and an index of the documentation in [`docs/`](docs/). It explains the proposed foundation, delivery boundaries, and required design gates.

The documentation details the [product plan](docs/01-product-plan.md), [architecture and security design](docs/02-architecture-and-security.md), data model, billing and operations, [AI agent skills](docs/05-ai-agent-skills.md), [delivery roadmap](docs/06-delivery-roadmap.md), and deployment strategy.
