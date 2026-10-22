# Existing-service dashboard and email evaluation brief

Evaluate `saas-add-dashboard-page` and `saas-add-email` as separate bounded tasks using Foundation services. See [module availability](../development/module-availability.md) and [email integration](../development/email-workflow.md). These fixtures authorize source changes and synthetic local delivery only, not publication or live email.

## Dashboard over existing Projects

Add an organization “Completed Projects” page over the existing authorized Project list API using its `status: completed` filter. Add an organization navigation link and English/Spanish labels. Show name, status, description and a route/action supported by existing services; no new table, unrestricted count or cross-resource search. Retain opaque cursor continuation even when a page is empty. The page has loading, empty, more-results, pending, denied/reauthentication and failure states; any mutation offered must also handle conflict and capacity/disabled policy.

Acceptance includes keyboard-only navigation with visible focus, semantic labels/status announcements, responsive light/dark layout, both locales, currently authorized rows and denial after revocation. An overlapping user switching organizations cannot receive the previous tenant's late response. Browser checks use actual services. Storybook checks cover shared components changed by the work. Preserve custom navigation and repeating the request adds no second link, route or message key.

## Identity notification after invitation acceptance

Add an `invitation-accepted` identity/security receipt to the accepting user after their successful organization invitation acceptance. The recipient is the verified user resolved under the existing lifecycle/tenant boundary, never a client-supplied address. The email says the invitation was accepted and links to the organization page built from the validated server origin. It includes no invitation token, member list or resource content. Existing English locale selection is acceptable for this bounded end-to-end fixture, but both English and Spanish renderers must work and the delivery limitation must be recorded; do not claim automatic Spanish delivery without implementing locale ownership.

Extend the strict identity payload kind, React Email content and tenancy notification hook/adapter through the existing encrypted delivery table and worker. No generic notification module is presumed. Set a bounded 24-hour delivery expiry at the accepted transition. Enqueue on the same transaction client after the accepted-state update; the already-accepted replay path must not enqueue another semantic receipt. SMTP delivery begins only after domain commit.

Verify successful acceptance yields one receipt, the replay yields no new receipt, and rollback/capacity/permission failure yields none. Test both rendered locales and HTML/plain text, escaping, link origin, transient transport retry, terminal exhaustion, expiry, stable delivery identity, protected payload storage/purge and sanitized diagnostics. At-least-once transport delivery remains explicit. Keep original verification/reset/magic-link/invite/transfer/recovery email tests intact.

Requirement IDs: `R-SKILLS`, `R-EMAIL`, `R-TENANCY`, `R-LIFECYCLE`, `R-AUTHZ` and relevant identity regressions. Evidence distinguishes rendered templates from an exercised domain-trigger/worker delivery path, and lists any remaining gaps.
