---
name: saas-add-dashboard-page
description: Add or change a localized accessible dashboard view over existing authorized services, with navigation, forms and complete UI states. Use when no new domain model is needed.
---

# Add a dashboard view

Read [AGENTS.md](../../../AGENTS.md), the [source map](../../../docs/development/feature-workflow.md), and existing route/component/contracts. Confirm the service exists in [module availability](../../../docs/development/module-availability.md). If persisted behavior or new permissions are needed, include add/evolve-feature work; a client component cannot supply a missing domain service.

The route family is `apps/web/src/app/[locale]/organizations/[organizationId]/`; navigation lives in `apps/web/src/components/organization.tsx`. Reuse `createApiClient` from `packages/api/src/client.ts`, actual oRPC contracts, React 19 and shared shadcn/ui/Tailwind controls. Forms use React Hook Form/Zod as in `packages/ui/src/project-form.tsx`. Locale messages live in `packages/ui/src/messages.ts`; inspect `apps/web/src/i18n/request.ts` before adding keys. No separate module/navigation registry exists to update automatically.

Keep authorization in server services. Route organization IDs select context; browser preferences, hidden controls and a previous success cannot grant access. Relation pickers use authorized endpoints. Empty cursor pages may have a continuation: offer it without inventing counts. Preserve expected versions and stable operation keys across retries of one submission; a new action gets a new key. Prevent responses for an earlier organization/query from replacing the current view.

Implement applicable loading, empty, pending, validation, denied/reauthentication, stale-version conflict, capacity/disabled and failure states with localized actionable text. Use semantic controls, visible labels/focus, keyboard operation, responsive layout, light/dark behavior and screen-reader status/error announcements. Preserve custom navigation; repeated requests add each registration/message once.

Add useful Storybook states and browser tests through real services, including keyboard and primary allow/deny journeys. Follow [verification](../../../docs/development/verification.md); screenshots/builds do not prove access or accessibility. The [dashboard/email brief](../../../feature-briefs/phase4-dashboard-email.md) provides an example. Deliver routes, evidence and unavailable states/services. Loading this skill does not authorize publishing.
