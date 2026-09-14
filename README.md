# common-sass

A reusable SaaS template designed to give you a foundation to build your own SaaS product on. It brings together the platform features that SaaS products commonly need, so you can focus on your product’s domain, workflows, and customer experience.

The planned foundation uses **Node.js, TypeScript, React, Next.js, shadcn/ui, and PostgreSQL**. It covers authentication, organizations and tenant isolation, relationship-based permissions, a dashboard, background jobs, and an entity generator for adding product features. Commercial and enterprise modules extend that foundation with subscriptions, usage tracking, integrations, SSO, and administration.

The template is intended to be source code you own and customize. You supply your product-specific features, business rules, branding, and pricing.

The default deployment runs the web app and background worker together in one Docker container, connected to external data services. Kubernetes deployment is optional.

**Status:** planning only. This repository currently contains the project plan, architecture and design specifications, and an example entity specification. The application and tooling have not yet been implemented.

## Planning and design

Start with the [project overview](docs/00-project-overview.md) for the original planning summary and an index of the documentation in [`docs/`](docs/). It explains the proposed foundation, delivery boundaries, and required design gates.

The documentation details the [product plan](docs/01-product-plan.md), [architecture and security design](docs/02-architecture-and-security.md), data model, billing and operations, entity generator, [delivery roadmap](docs/06-delivery-roadmap.md), and deployment strategy.
