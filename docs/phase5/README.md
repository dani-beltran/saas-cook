# Phase 5 — Monetization

Phase 5 implements local usage/quota enforcement and optional Stripe fixed/seat billing.
**Phase 5 is completed and accepted for its documented scope as of 2026-10-19.**
See the [acceptance record](acceptance.md) for the passed gates, evidence and limitations.
Phase 6 can begin; M2 Commercial still requires its modules and recovery gates.
The [brief](../feature-briefs/phase5-monetization.md) records the product decisions.

## Start without Stripe

Use Bun 1.4.2, Node 24.19.0 and the [Foundation setup](../phase2/README.md).
Apply `bun run db:migrate` using the migration role. Migration `0010_phase5_monetization`
is additive to the populated 0009 predecessor; it adds billing/usage tables and backfills
membership seat accounting. Migrations 0000–0009 are unchanged. Repeating migration is safe.
The existing authorization model is unchanged; do not bootstrap an existing installation.

Leave `BILLING_ENABLED=false` (default). Current human/service-account authorization,
local Project capacity, seat admission and monthly Project creation quotas remain real
PostgreSQL enforcement. Owners/billing managers can open
`/{locale}/organizations/{organizationId}/billing` and `/usage` in English or Spanish.
Billing permission does not grant Project-content permission. Billing API endpoints reject
all bearer principals, including when a valid session cookie is also present.

`DEFAULT_PROJECT_CAPACITY` remains the existing capacity initialization default.
`DEFAULT_PROJECT_CREATES_PER_MONTH` independently defaults to 1000, accepts 0 through
1000000 or `unlimited`, and governs consumption. `USAGE_NOTICE_THRESHOLDS` defaults to
`80,95,100` and accepts up to ten distinct percentages in 1–100. These are configurable
template defaults, not production pricing. A provider switch never bypasses a previously
confirmed commercial restriction or security suspension.

## Enable a reviewed Stripe catalogue

Configure both web and worker with `BILLING_ENABLED=true`, `STRIPE_MODE=test|live`,
`STRIPE_SECRET_KEY`, `STRIPE_ACCOUNT_ID`, `STRIPE_WEBHOOK_SECRET`, and
`STRIPE_PORTAL_CONFIGURATION_ID`. Validation rejects incomplete/mismatched modes before
work starts. The adapter checks the authenticated account against the configured account.
Builds require none of these values. Use separate restricted web/worker roles; never pass
migration or control-admin credentials to `serve`.

The installed Stripe SDK is 23.0.0 with API/event version `2026-09-30.endive`. Configure
snapshot webhook delivery to `/api/webhooks/stripe` with that event version. Subscribe to
subscription, Checkout, invoice and subscription-schedule lifecycle events. Unsupported
versions/accounts/modes are quarantined; the application does not reinterpret their payloads.
Acknowledge only after a verified envelope and raw-byte digest commit to the durable inbox.
Raw event bodies and card details are not persisted or logged.

The Endive upgrade uses `allowed_payment_method_types: ["card"]` for Checkout; the
removed `payment_method_types` request parameter is not sent. Existing sold catalogue
versions and local billing history are unchanged. Configure the webhook endpoint version
before enabling the upgraded adapter; older event versions remain quarantined. The sandbox
CLI listener checks its reported version against the pin before opening Checkout, so a
future change to Stripe's latest version fails before requesting a browser payment.

Create a Portal configuration with invoice history and payment-method updates enabled,
and **both subscription updates and cancellations disabled**. The adapter verifies this
before creating a Portal session. Application cancellation uses the paid-through date;
application decreases use a reviewed renewal preview and occupied-seat check.

Create real recurring licensed, per-unit prices with one-month or one-year intervals in
Stripe test mode. Then import an explicit catalogue with the migration role:

```sh
bun run billing:catalogue --file /absolute/path/to/reviewed-catalogue.json
```

Example structure (IDs and EUR 10 are synthetic; replace after choosing commercial policy):

```json
{
  "environment": "test:acct_SYNTHETIC",
  "plans": [{
    "plan": {
      "id": "team/v1", "key": "team", "version": 1, "name": "Synthetic team",
      "mode": "seat", "trialDays": 0,
      "features": {
        "projects": {"kind": "limited", "limit": 50},
        "projectCreates": {"kind": "limited", "limit": 100},
        "seats": 1
      },
      "graceHours": 24, "snapshotHours": 24
    },
    "price": {"id": "price_SYNTHETIC", "currency": "eur", "amount": 1000, "interval": "month"}
  }]
}
```

Amounts are integer Stripe charge minor units. Fixed plans require quantity 1 and use their
configured seats; seat plans use confirmed purchased quantity. Free plans have no provider
price; the credential-free Foundation policy is the initial free source. A catalogue import
is idempotent, but sold definitions and environment/price mappings cannot be updated or
deleted. Introduce a new version and an explicit change for migrations. Archiving a Stripe
price prevents new purchases; existing subscriptions keep their version. Multi-item,
metered, tiered, transformed-quantity and manually collected subscriptions are unsupported
and require review rather than guessed access.

## Commands, lifecycle and outages

A billing manager submits a scoped idempotent command. Commands persist before any network
call. Provider calls run outside domain transactions under a per-account session lock on
the same live connection used to publish results. Current actor authority is checked before
submission, with a five-minute authorization deadline. Retries retain the original command
and provider keys; attempts are bounded at eight. An ambiguous operation older than the
conservative twenty-hour idempotency horizon enters review and is never resubmitted.
Reconciliation may complete a reviewed command when current provider truth proves its
requested result. An unresolved reviewed command blocks further financial changes; do not
reset its key or delete its receipt to force another charge.

The worker reconciles current provider truth every five minutes, sooner for due commands
and accepted events. A pre-fetch database timestamp bounds inbox receipts. It atomically
publishes sold version, entitlements, purchased capacity, eligible seat occupancy, invoices,
audit/outbox, reconciliation receipts and processed inbox entries. Duplicate/missed/out-of-order
events therefore converge without event-order patches. Unknown customer mappings are retained
in quarantine and can be picked up after a trusted mapping is established.

Provider status, product access, organization/user security lifecycle and reconciliation
health are separate. A redirect or requested upgrade grants no paid access. Incomplete
subscriptions remain pending; trials end at their confirmed deadline; past-due grace starts
once per delinquency episode. Unpaid/canceled/expired subscriptions retain authorized reads
and cleanup but deny paid positive mutations. No employee is automatically removed.
Confirmed snapshots are bounded by the sold plan's `snapshotHours` and lifecycle deadlines.
Outages retain only unexpired rights. Unknown prices require review rather than new rights.

Admission uses the existing lifecycle order: all affected user fences before organization,
then seat/membership rows, with current authorization and a final transaction-wide expiry
check. Pending/scheduled decreases impose an admission ceiling. External downgrades record
the actual purchased capacity even below occupancy; positive admission is blocked while
over capacity and repeated deactivation remains idempotent. Reconciliation counts eligible
memberships and preserves an explicit counted flag so expiry cleanup cannot double-release.

```sh
bun run billing:reconcile --organization <uuid>
bun run billing:diagnostics --organization <uuid>
bun run usage:rebuild --organization <uuid> --bucket <uuid>
```

These worker-role commands require independent readiness and explicit tenant scope. The
image packages `billing-catalogue`, `billing-reconcile`, `billing-diagnostics`, `usage-rebuild`
in addition to existing modes. Diagnostics expose bounded status/counts, not provider
payloads, credentials, addresses or hosted session URLs. Quarantined mapping/version events
and unresolved reviews require trusted mapping/configuration/provider investigation;
there is no unsafe arbitrary remapping or force-charge command.

## Usage contract and notices

`projects.created`, version 1, is a sum of integer `project` units with no dimensions.
The exact trigger is the first successful Project creation transaction. Occurrence time is
the database reservation time; receipt time is separate. The period is UTC calendar month
`[start,end)`. Failures roll back, retries deduplicate across periods, and restores/deletions
neither consume nor refund usage. Corrections append signed adjustments linked to an original
event in its original window; they never rewrite history. Correction helpers require an
already authorized, canonically fenced transaction and an explicit reason/idempotency key;
no public correction endpoint or Backoffice application is enabled.

Window buckets serialize final-unit reservations, expire/release unused claims and settle
with the domain mutation. Settlement adds its deadline to the transaction-wide expiry guard.
Local and commercial policy intersect and retain missing/disabled/zero/limited/unlimited
semantics. Aggregates are rebuildable from append-only events and live reservations with a
watermark/version and audit receipt. Capacity, window consumption, API burst limits, analytics
and provider-rated usage are distinct. The `UsageBillingProvider` interface is retained;
provider-based metered charging is disabled and has no accepted adapter.

Billing lifecycle and usage-threshold notices use a dedicated durable tenant queue, rather
than identity-token payloads. A threshold key includes organization, metric, window and
percentage. Delivery chooses currently eligible verified owners/billing memberships,
rechecks lifecycle, readiness and billing permission, and encrypts short-lived payloads.
English/Spanish rendering selects the billing account's last Checkout locale; organizations
without an account use English. Per-recipient locale preferences remain future work.

Delivery expires after seven days, attempts at most eight times, and purges encrypted
payloads on delivered/expired/revoked/exhausted outcomes. SMTP runs after the authorization
transaction; a stable Message-ID helps recipients deduplicate. Delivery is at least once,
including an ambiguous SMTP success/receipt crash. Local Mailpit proves transport/rendering;
external inbox delivery, spam placement and provider deliverability are not established.

## Verification and reuse

See [acceptance](acceptance.md), [evidence](evidence.json), and [skill evaluation](evaluation.md).
`bun run test:integration` fails if required services are unavailable. CI adds a required
`monetization` job for the billing, usage, migration, transport and notice suites; the ordinary
full integration/browser/image jobs also cover these sources. PR jobs receive no Stripe key.

```sh
bun run billing:sandbox --env-file /absolute/path/to/test.env --stripe-cli /path/to/stripe
# Adds a local redirect for a browser-completed synthetic hosted payment:
bun run billing:sandbox --env-file /absolute/path/to/test.env --stripe-cli /path/to/stripe --hosted-checkout
```

The sandbox runner refuses live keys, uses isolated PostgreSQL/OpenFGA and synthetic Stripe
products/prices/test clocks, records redacted source-versioned evidence under `artifacts/phase5`,
and cleans up its test resources. API-only evidence leaves hosted payment acceptance pending.
Real CLI delivery uses signature validation and the production inbox service; this does not
prove a deployed internet endpoint's TLS/routing configuration. The CLI is an external test
prerequisite, not a workspace dependency.

The adapter implements the official [webhook](https://docs.stripe.com/webhooks),
[pending-update](https://docs.stripe.com/billing/subscriptions/pending-updates),
[invoice preview](https://docs.stripe.com/api/invoices/create_preview),
[schedule](https://docs.stripe.com/api/subscription_schedules/update),
[idempotency](https://docs.stripe.com/api/idempotent_requests), and
[currency](https://docs.stripe.com/currencies) contracts reviewed alongside SDK types.
Sandbox failures and corrected repeats are retained, not relabeled as passes.

Future BO-04 must reuse this catalogue, command, inbox, projection and ledger architecture,
adding its own operator authority/approval boundary. It must not masquerade as a tenant user
or implement another charging system. Phase 6 deletion/recovery, generic notifications,
files, analytics and the optional Backoffice remain outside this implementation.
