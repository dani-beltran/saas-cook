# Transactional email integration

The implemented Foundation path is domain transaction → encrypted delivery record → worker delivery. It covers identity/security journeys. Read [canonical durable work and notifications](../04-billing-usage-operations.md#durable-work), [identity/tenancy contracts](../02-architecture-and-security.md#25-authentication-and-identity-ownership), and [module availability](module-availability.md) for broader requests.

## Actual integration points

| Responsibility | Source |
| --- | --- |
| Strict payload, encryption, enqueue, bounded retry/expiry | [delivery.ts](../../packages/email/src/delivery.ts) |
| English/Spanish React Email, HTML and plain text | [identity.tsx](../../packages/email/src/identity.tsx) |
| SMTP adapter and stable Message-ID | [smtp.ts](../../packages/email/src/smtp.ts) |
| Tenancy notification hook and transaction | [tenancy.ts](../../packages/db/src/tenancy.ts) |
| Hook composition and server-origin URL | [runtime.ts](../../packages/api/src/runtime.ts) |
| Identity ceremony enqueue | [auth/index.ts](../../packages/auth/src/index.ts) |
| Delivery loop and readiness | [worker/index.ts](../../apps/worker/src/index.ts), [diagnostics.ts](../../apps/worker/src/diagnostics.ts) |
| Render and delivery regressions | [email.test.ts](../../packages/email/src/email.test.ts), [identity.integration.test.ts](../../packages/auth/src/identity.integration.test.ts), [worker.integration.test.ts](../../apps/worker/src/worker.integration.test.ts) |

`enqueueIdentityEmail` accepts a transaction client; use that client for atomic domain events. Do not enqueue via a separate pool after successful writes if the operation promises atomic delivery creation. Workers cannot see uncommitted records, so a rolled-back transaction sends no mail. SMTP runs after domain commit. A delivery receipt can fail after the transport accepted the message: retries are at least once, with stable identity for deduplication, not exactly once.

Define the semantic event, authorized recipient, locale, expiry and payload fields explicitly. Place replay prevention at the domain transition/receipt boundary so the same command does not enqueue another message. React escaping handles plain text; rich HTML needs an explicit sanitization policy. Render both HTML and text. Keep addresses and token-bearing URLs inside protected delivery data, out of ordinary domain audit/outbox/log payloads. Use validated server origin and a known path; caller-controlled redirects do not belong in email.

Current tenancy notifications select English in runtime composition. Adding Spanish copy alone does not make delivery choose Spanish. Extend locale ownership intentionally and test selection if requested. The runtime preview email in `index.tsx` is synthetic and cannot substitute for a real trigger.

New resource notifications need a durable consumer, current recipient/lifecycle/permission checks at execution, and an appropriate data-retention design. Do not stretch the identity payload into an undocumented generic notification queue. New provider configuration, live recipients or delivery to external systems require task authorization; synthetic Mailpit/fake-transport tests are sufficient for local implementation work.

Verification should prove one semantic message for a replay, no message on rollback, both locales and escaping, unavailable transport recovery, bounded exhaustion, expiry, stable Message-ID, protected/purged payload behavior and sanitized error counters. Preserve original identity-journey tests. Record the exact exercised path, including any locale or recipient behavior not implemented.

## Phase 5 mandatory billing delivery

`packages/email/src/billing.tsx` adds a dedicated encrypted tenant delivery boundary for
billing lifecycle and usage-threshold notices. It does not extend identity token payloads.
The transactional notice enqueue, current recipient checks, locale ownership, seven-day
expiry, eight-attempt bound and at-least-once SMTP limitations are recorded in the
[Phase 5 guide](../phase5/README.md#usage-contract-and-notices). Use that existing consumer
for compatible billing notices; general resource notifications remain Phase 6 work.
