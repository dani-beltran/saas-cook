# Phase 5 — Monetization

Status: implementation delivered and local application/performance checks passed; release remains unaccepted
until all gates in [the acceptance register](../phase5/acceptance.md) are satisfied.
Baseline: `a35fa43` (clean working tree at start), following the accepted Foundation
and subsequent product rename. Applied migrations 0000–0009 remain immutable.

## Scope and decisions

Implement fixed/seat Stripe subscriptions, immutable sold plan versions, hosted
Checkout/Portal, durable commands/inbox/reconciliation, commercial entitlement
sources, local usage and hard quotas, billing/usage screens and mandatory notices.
Phase 6, Backoffice, contract overrides and provider-metered charging are excluded.
The metering interface remains disabled; synthetic provider tests never establish
Stripe acceptance. Phase 5 completion does not accept M2 Commercial.

One organization owns one billing account in one configured Stripe account/mode.
Only current owners and billing memberships can manage billing; these rights grant
no Project-content permissions. Browser endpoints support verified humans only and
reject every bearer header without cookie fallback. Service principals continue to
use their explicitly declared Project endpoints and consume the same quotas.

Prices/currencies/features are operator-installed, validated catalogue data, with
stable keys and immutable versions/mappings. Example amounts are synthetic. Local
Foundation defaults remain configurable and enforce real policy without Stripe.
Requested upgrades and redirect returns confer no entitlements. Upgrades use paid
pending updates; decreases are scheduled for renewal and rejected below current
occupancy. Portal subscription changes are disabled; payment/invoice management
remains hosted. External downgrades record truth and never evict members.

Provider status, product access, security lifecycle and synchronization health are
separate. Confirmed snapshots have bounded validity; expiry disables paid positive
mutations while preserving authorized reads/cleanup. Past-due grace has a fixed
episode start, never extended by replay. Security suspension always dominates.

The initial metric is `projects.created` version 1: one integer Project per
successful first creation, counted atomically with the business transaction, UTC
calendar month `[start,end)`, no dimensions. Failed creates, retries, restores and
deletions do not create/refund usage. Explicit append-only corrections refer to
original events and their original windows. Consumption, capacity, burst limits,
analytics and provider-rated charges remain separate.

Mandatory billing/threshold notices target currently eligible owners/billing
memberships. Store only encrypted short-lived delivery payloads, recheck recipients
at dispatch, render English/Spanish, and use stable delivery IDs. SMTP is at least
once. Thresholds default to 80/95/100 percent, configurable and deduplicated by
organization/metric/window/threshold. No customer mail is sent during tests.

## Invariants

Compatibility decision (2026-10-19): use Stripe SDK 23.0.0 and API/snapshot event version
`2026-09-30.endive`, as requested after the hosted repeat exposed CLI latest-version drift.
Preserve card-only Checkout through `allowed_payment_method_types`, strict event-version
quarantine, immutable sold definitions and current billing history. No schema migration or
shared sandbox default-version change is required. Review deployed webhook versions before
enabling the new adapter; retained pre-upgrade evidence describes its original source only.

- Canonical user → organization → seat/membership lock order, forced tenant RLS,
  independent readiness and final transaction-wide authorization expiry.
- Domain writes, usage, source versions, audit/outbox and processing receipts commit
  atomically. External provider calls occur outside domain transactions.
- Persist each scoped command before submission; retry identical provider keys only
  within a conservative provider retention horizon. Ambiguous old operations require
  reconciliation rather than a new charge. Serialize account processing on its live
  database connection; a lost connection cannot publish a late result.
- Verify raw webhook bytes before durable acceptance; unknown mappings/version/mode
  remain quarantined. Events prompt current-truth reads, not ordered state patches.
- Existing subscribers keep the immutable version mapped to their confirmed price.
  Local policy remains an independent restriction on purchased rights.
- Usage operation keys survive period boundaries. Reservations, expiry, release,
  corrections and rebuilds serialize on a window bucket and preserve ledger history.
- Logs and public DTOs omit credentials, raw provider payloads, customer IDs and
  payment details. Customer data is never a trusted tenant-routing instruction.

## Delivery slices and acceptance

1. Schema/catalogue/usage: reviewed additive migration and snapshot; fresh and 0009
   upgrades preserve populated data; restricted-role isolation; quota final-unit
   races, rollback/retry/correction/rebuild/period tests; real Project integration.
2. Provider orchestration: signature/replay/order/missed events, customer mapping
   isolation, bounded retries/crashes/ambiguity and reconciliation receipts.
3. Entitlements/seats: free/trial/pending/active/grace/unpaid/cancel/outage; confirmed
   capacity, external downgrade versus admission and repeat deactivation; current
   permission and expiry; billing-only principals denied unrelated content.
4. API/UI/notices: strict RPC/REST parity, explicit principals, plan previews and
   effective dates, seats/invoices/usage/reset/health, localized accessible states,
   encrypted durable delivery with rollback/deduplication/expiry/retry evidence.
5. Release: source/types/Knip/unit/integration/build/browser/Storybook/skills/image/
   security, renewed performance assessment, Phase 5 skill evaluations and genuine
   Stripe sandbox lifecycle evidence. Record every limitation and unaccepted gate
   in docs/phase5/acceptance.md and diagnostic artifacts under artifacts/phase5.
