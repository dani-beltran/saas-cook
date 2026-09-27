# Independent Backoffice

Status: **planned; documentation only**, 2026-09-27. No application, migration, provider integration or infrastructure is delivered by this brief. The [roadmap](../docs/06-delivery-roadmap.md#67-backoffice-planned-delivery-and-acceptance) is the acceptance register; [architecture](../docs/backoffice/architecture.md) owns the proposed design and [development plan](../docs/backoffice/development-plan.md) owns work sequencing and evidence. Existing platform contracts remain authoritative until their explicitly scheduled amendments are reviewed.

## Outcome and assumptions

Provide operations, support, customer success, finance, privacy and security staff with a controlled way to understand and administer the platform without database consoles or customer credentials. Create `apps/backoffice`, a separately configured Next.js application with its own hostname, operator authentication, sessions, network controls, runtime roles, version and Docker image. The customer application must start and operate with no Backoffice process, credentials or provider configuration.

Recommend two independently deployable applications in one modular monolith, sharing reviewed service code and initially one application PostgreSQL database. Use separate operator identity/metadata schemas and database roles; retain the already independent control store. A second business database or a network hop between every service call is not required for application independence. They remain extraction options if measured load or isolation obligations require them.

Planning assumptions, subject to the decisions below:

- A small internal team, one installation and one operating environment per deployment; no customer-accessible Backoffice and no mobile/offline client. English and Spanish reuse the repository's localization patterns.
- Initial release means the **read-only internal release BO-00–BO-02**, after required Foundation evidence and security/image gates. Later means a required planned Backoffice increment, not a placeholder in that release. Optional capabilities need separate enablement and acceptance.
- Production operators enroll by invitation through an independently verified staff process and use verified passkeys with user verification. No public registration, customer-role promotion or email-only recovery. Corporate SSO is a later adapter unless organizational policy makes it an initial prerequisite.
- Stripe remains the recommended fixed/seat billing provider from Phase 5. Zendesk is a provisional first help desk adapter, replaceable before integration without changing domain contracts. No vendor account or paid plan is assumed available.
- Concrete numeric limits below are proposed product/security defaults, not measured capacity, legal requirements or accepted SLAs. Owners ratify them in BO-00.

## Capability and priority matrix

All rows describe planned behavior. `C-*` identifies product scope; work IDs and gates resolve in the [traceability table](../docs/backoffice/development-plan.md#requirement-traceability).

| ID | Capability and user outcome | Priority / work | Prerequisite and boundary |
| --- | --- | --- | --- |
| C-01 | Operator enrollment/offboarding, MFA, step-up, scoped roles, secure sessions and network admission | Initial / BO-01 | Dedicated identity and policy boundary; no customer identity privilege inheritance |
| C-02 | Search/filter/browse organizations, global accounts and memberships by ID, masked identity, lifecycle, created date and assigned case scope | Initial / BO-02 | New bounded operator queries; exact-email lookup requires explicit identity-search permission; no global unrestricted totals |
| C-03 | Organization detail: owners, member states, local seat occupancy/capacity, local entitlements and relevant audit/history | Initial / BO-02 | Current authoritative lifecycle reads. Subscription, usage ledger and integration panels appear only when their services exist |
| C-04 | Reveal sensitive fields briefly; separately authorize export of permitted fields | Reveal initial / BO-02; export later / BO-05 | Reason/case, step-up, audit before disclosure; reveal never implies export |
| C-05 | Controlled suspension, reactivation, global/session revocation and recovery case tracking | Later / BO-03 | New operator service commands; existing signed deactivation/recovery remains independent; positive transitions retain seat and readiness checks |
| C-06 | Plans/versions, subscriptions, trials, invoices, payments, credits, discounts, seats, usage and reconciliation history | Later / BO-04 | Phase 5 authoritative commercial services; masked provider metadata, never card data |
| C-07 | Manual plan change, trial extension, bounded custom discount and approved effective/expiring contract or entitlement override | Later / BO-04 | Phase 5 commands; limited override service pulled forward from Phase 7 explicitly; sold versions are immutable |
| C-08 | Refund, credit, cancellation and dispute case handling | Later / BO-04 | Preview, independent approval and provider confirmation. Disputes initially show deadlines/status and verified provider links; evidence submission automation optional |
| C-09 | Dunning queue, failed-payment history, reminders, retry status, grace, escalation and recovery reporting | Later / BO-04 | Provider owns collection retries; application owns access policy and assigned cases; one sender per notice |
| C-10 | Privacy intake, requester verification, rights/scope review, assignment, deadlines, evidence and response tracking | Later / BO-05 | Legal-approved jurisdiction policies and Phase 6 lifecycle services; intake can precede automation, but cannot claim fulfillment |
| C-11 | Organization export and individual data-subject export | Later / BO-05 | Separate scope/permissions; Phase 6 inventory, file/export jobs, storage and current download access |
| C-12 | Organization and multi-organization personal account deletion, retention and restore suppression | Later / BO-05 | Phase 6 independent journal and recovery; basic hold checks mandatory before any purge; advanced holds remain Phase 7 |
| C-13 | Environment/org flags, segments, percentages, schedules, expiry, ownership, history, rollback and emergency disable | Later / BO-06 | Phase 6 shared evaluator and customer runtime changes; no operator HTTP call on customer requests |
| C-14 | Localized targeted banners/announcements and registered walkthrough triggers | Later / BO-06 | Phase 6 delivery/preferences; draft/preview/review/schedule/dismiss/frequency/expire/rollback; safe typed content |
| C-15 | Verified help desk identity links and minimal ticket summary | Later / BO-06 | One tested adapter and approved mapping; no full ticket-body mirror or write-back in minimum release |
| C-16 | Job/outbox/webhook status, redacted dead-letter detail, email diagnostics and provider reconciliation | Metadata initial / BO-02; actions later / BO-03, BO-06 | Existing probe/mail diagnostics only initially; each new consumer must supply a replay contract |
| C-17 | Incident controls and safe bulk actions | Later / BO-03, BO-06 | Pausing a named dispatcher, disabling a rollout and bounded typed batches; no arbitrary SQL/job runner |
| C-18 | MRR/ARR, customer/revenue churn, expansion/contraction, retention, trial conversion and payment recovery | Later / BO-07 | Phase 5 reconciled facts; Phase 6 analytics only for product retention; finance-approved definitions |
| C-19 | CAC and LTV with source/freshness/confidence | Later presentation / BO-07; external connector optional | Cost, attribution and margin inputs required; unavailable until supplied, estimates labeled |
| C-20 | Searchable operator audit, sensitive-read audit, approval/denial history and restricted audit export | Initial audit / BO-01; export later / BO-05 | Append-only privileges; audit is separate from logs, analytics and activity feeds |
| C-21 | Corporate SSO and automated staff offboarding | Later / BO-07 with Phase 7; initial if corporate policy requires | Pinned adapter proof, verified issuer/subject, no automatic access from an email domain or customer IdP |
| C-22 | Temporary delegated support access | Optional / BO-X01, excluded by default | Separate product justification, tenant consent policy, bounded supported actions and dedicated gate; fabricated customer sessions forbidden |
| C-23 | Impersonation as a customer, arbitrary data editing, custom scripts, full accounting/CRM/marketing automation | Excluded | No demonstrated need; do not enlarge the initial operations scope |

Platform organizations and global user accounts are the service's tenants and identities. `tenancy.example_customers` contains customer-authored business records; it is neither a tenant directory nor a billing customer catalogue. The initial Backoffice cannot browse Project descriptions, example-customer emails or other business content. A platform account page may show an authorized membership summary across organizations; an organization page cannot reveal unrelated memberships just because a user belongs to that organization.

## Principal journeys and field exposure

Support selects a reason/ticket, finds an organization by stable ID/name and sees a masked overview with freshness and recovery state. If exact email lookup or revealing an owner contact is needed, the server checks a separate permission and case scope, requires recent MFA and commits a disclosure audit before returning it. Default list DTOs contain ID, safe label, lifecycle and timestamps; allowlisted detail adds local policy and seats. Identity credentials, challenges, keys, raw provider payloads and private resource content are never returned. Search filters, detail, reveal, export, audit and event fields have separate allowlists. Query text containing personal data is not copied into logs or cursors in plaintext.

Operations previews an exact suspension target and its effect on sign-in, memberships, API keys, workers, billing and support sessions. Organization suspension is distinct from account freeze, membership deactivation, delinquency and deletion. Resuming one cause does not clear another. Security may revoke a single session or all current sessions of an exact account without deleting memberships. Global account actions show all affected organizations and demand global scope. Reactivation never resurrects old sessions, revoked grants or keys.

Finance previews a subscription change against current provider state, sold plan version, active seats and policy version. The preview shows currency, gross/net amounts, taxes if available, discount/proration, effective date, next invoice, entitlement delta and consequences for occupied capacity. Submission returns a tracked command, not “plan changed.” The screen distinguishes requested, awaiting approval, submitted, provider-pending, confirmed, rejected and reconciliation-required. Each obligation has one charging owner. An approved manual contract cannot accidentally also trigger self-service collection.

Privacy verifies identity and authority for the requested right and subject. A corporate export is not an individual access request: the latter collects that subject's personal data while redacting other people and protected organizational content. Deletion previews list ownership obligations, continuing organizations, objects/providers and retention exceptions. Confirmation uses the immutable target ID and displayed name, a fresh preview and the approved scope. The independent journal and recovery protocol determine scheduling, cancellation and final cleanup status; a green UI cannot substitute for receipts.

## Dangerous-action policy

Every dangerous action follows the [command protocol](../docs/backoffice/architecture.md#operator-command-protocol): request → validate → preview → authorize/step-up → applicable approval → execute → reconcile/retry → audit → final status. Requests and approvals bind a payload hash, exact target(s), expected versions, environment, installation/recovery epoch, effective date, limits and expiry. A changed preview needs new approval. A requester cannot approve their own request; a platform administrator has no blanket finance/privacy approval power.

Proposed release defaults:

| Action | Required control | Reversal / terminal boundary |
| --- | --- | --- |
| Read masked operational fields | Current scoped permission and read audit | Returned data cannot be recalled |
| Reveal contact/identity or download export | Case scope, separate permission, MFA ≤5 minutes, durable audit | Disclosure irreversible; revoke future access immediately |
| Session revocation / security suspension | Security scope, reason, fresh MFA; incident authority for urgent revocation | Revoked credentials remain revoked after reactivation |
| Ordinary organization suspension/reactivation | Operations requester plus distinct operations/security approver | Reversible only after new validation; independent recovery state remains closed |
| Plan change / trial extension | Finance permission, current preview; initial policy requires distinct finance approval for every manual change | Cancel before provider submission; afterward use a new compensating command |
| Discount / refund / credit / manual override | Distinct finance approver; amount/currency ceiling, interval and contract reference | No automatic reversal of settled money; remaining refundable balance checked again |
| Account/org deletion | Verified requester, privacy reviewer plus security/operations executor, hold policy and exact confirmation | Account cancellation only before confirmation/freezing; organization cancellation only while canonical journal/purge rules permit |
| Network/role change | Security author plus distinct security approver; lockout check | Versioned rollback; no self-promotion or `0.0.0.0/0` emergency shortcut |
| Bulk action | Preview fixed target/version manifest, default cap 100, distinct approval, per-item result | Stop unstarted items; committed effects retain their ordinary semantics |

Finance may later approve per-currency delegated thresholds in versioned policy. Until amounts are decided, all manual monetary/contract/trial changes require dual control; a missing threshold never means unlimited. Security emergency revocation is not delayed awaiting finance or a second approver, but the existing signed `security:deactivate` command still requires its independent approval and fresh MFA.

## Metric definitions proposed for finance review

Use organization as the customer unit, UTC half-open calendar months and month-end recurring run rate, separated by currency. Exclude test/internal organizations and one-time implementation fees. Every tile shows definition version, period/cohort, source, last complete watermark, exclusions, and estimated/unavailable status. These are proposed operational metrics, not revenue recognition or accounting statements.

| Metric | Definition and needed inputs |
| --- | --- |
| MRR / ARR | Sum confirmed recurring net contractual amount normalized to one month; annual recurring amount /12; ARR = 12 × MRR. Exclude tax and nonrecurring usage/credits/refunds. Allocate recurring discounts over their effective service periods. Show contracted MRR separately from delinquent/collectible exposure and net cash collections |
| Customer churn | Start-of-month paid organizations losing all paid recurring subscriptions during month / start-of-month paid organizations. Exclude new customers from denominator; show reactivations separately; an organization with a surviving paid subscription has not churned |
| Revenue churn / expansion / contraction | Churned recurring MRR and contraction of surviving starting-cohort MRR, each / starting MRR. Expansion is starting-cohort positive delta. GRR = (start − churn − contraction)/start; NRR = (start − churn − contraction + expansion)/start. New customers excluded; zero denominators display unavailable |
| Retention | Logo retention = surviving starting paid customers/start. Product retention separately uses the Phase 6 activity cohort contract; no inference of activity from payments. Display monthly cohorts by first confirmed paid start, age and maturity |
| Trial conversion | Organizations whose first eligible trial ended in the cohort window and achieved first confirmed payment by 30 days after trial end / eligible ended trials. Exclude internal tests; deduplicate repeated trials per declared rule; immature cohorts explicitly incomplete |
| Payment recovery | Recovered delinquent principal / failed principal in a fixed invoice cohort over 30 days; also recovered-invoice and customer rates. Exclude voided invoices; partial payment counts only collected value; refunds/chargebacks reported as adjustments, not a second recovery |
| CAC | Finance-approved acquisition sales/marketing cost for the cohort / new paid organizations attributable to that cohort; require CRM/channel attribution, campaign spend, payroll allocation, commissions, agency costs and lag policy. Blended CAC and attributed CAC are distinct; missing costs are not zero |
| LTV | Prefer observed cumulative cohort gross profit per acquired organization (explicitly “observed to date”). Optional modeled LTV = monthly ARPA × gross margin / monthly logo churn, with stable comparable cohort/window assumptions. Require COGS/support/hosting/payment costs; zero churn or insufficient history gives unavailable, never infinite value |

Keep payment/refund/credit/dispute cash measures separate from recurring run rate and accounting revenue. Refunds that change future recurring terms affect MRR prospectively; refunds of past service affect net collections and observed cohort gross profit. Report original currency first. Consolidated reports require a named FX source, rate date and version, and show constant-currency changes separately. Never sum currencies or silently use today's FX for history. Preserve restated report versions and reconciliation differences rather than rewriting prior sign-off.

## Decisions requiring named owners

| Decision | Owner / due | Safe planning assumption |
| --- | --- | --- |
| Initial staff cohort, tenant scopes and business-content access | Product + security / BO-00 | Read-only metadata; no delegated support access |
| Corporate IdP, enrollment/recovery authority, MFA/session durations and emergency network route | Security / BO-01 | Passkey enrollment under independent staff verification; 30-minute idle, 8-hour absolute session, 5-minute step-up; production blocks without approved network design |
| Finance powers, currencies, thresholds, proration, grace and contract ownership | Finance + product / BO-04 | Dual approval for all manual commercial changes; no configured policy means the action is unavailable |
| Rights applicability, controller/processor duties, retention/holds, deadlines and export recipients | Legal/privacy / BO-05 | No production purge or rights fulfillment until reviewed policies; no blanket legal deadline baked into code |
| Help desk provider, data region and minimal scopes | Support + security/privacy / BO-06 | Zendesk adapter proposal, verified links and metadata only |
| Metrics, cost allocation, FX, cohort maturity and allowed estimates | Finance + customer success / BO-07 | Per-currency reconciled measures; CAC/LTV unavailable where inputs are absent |
| Shared database acceptable for operator compromise blast radius | Security / BO-00 | Restricted schemas/roles and bounded services; private API extraction if policy requires stronger process isolation |

These choices do not block documenting the architecture. Each becomes an explicit implementation/release prerequisite where indicated, not an implicit approval or license assumption.

## First implementation slice

Implement BO-01's secure shell plus BO-02.1's **masked organization lookup by exact ID**, after BO-00 decisions and the Foundation prerequisite. A registered operator signs in at the separate host, opens one organization overview containing ID/name/lifecycle and local seat summary, and sees a correlation reference. Reads are audited; an offboarded operator, wrong network, customer cookie, wrong scope or unavailable readiness/audit boundary receives no data. This slice has no tenant mutations or commercial panels.

Definition of done: separate credential-free builds and images; real restricted-role schema tests; synthetic staff enrollment/MFA; session/cookie and ingress isolation tests; current operator authorization under fences; durable read audit; two-organization negative cases; customer-image route/bundle exclusion; customer sign-in, Project CRUD and worker mail continue with Backoffice stopped; keyboard and localized loading/denied/unavailable states; retained evidence tied to both image digests. The full initial release adds the bounded directories and details in BO-02. No placeholder UI, provider stub or local smoke closes a release gate.
