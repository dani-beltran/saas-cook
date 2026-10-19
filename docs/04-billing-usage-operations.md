# 4. Billing, usage, audit, and operations

Implemented Phase 5 boundaries, configuration, exact metric contract, state policy and scoped
commands are documented in [Phase 5 operations](phase5/README.md). Its [acceptance record](phase5/acceptance.md)
distinguishes local and real Stripe evidence from outstanding release gates. The later modules
and recovery protocol in this design remain due in their scheduled phases.

## 4.1 Separate the commercial concepts

| Concept | Question it answers | Owner |
| --- | --- | --- |
| Authentication | Who is calling? | Identity/session adapter |
| Authorization | May this actor perform this action on this resource? | Tenant boundary + ReBAC |
| Entitlement | Has this organization purchased/enabled this feature? | Versioned plan/contract resolver |
| Quota | Can this operation consume this amount right now? | Transactional quota service |
| Usage | What measurable activity actually occurred? | Durable usage ledger |
| Billing | What should be invoiced/collected and what is its status? | Billing provider + local projection |
| Feature flag | Should this application/tenant receive this rollout? | Product/platform configuration |

An enabled feature flag does not grant permission or paid access. Paying for a feature does not grant every employee permission to use it. An analytics event is not a reliable billable usage record.

Foundation delivers the typed entitlement resolver, local policy catalogue, transactional capacity reservations, and membership seat-admission service before the reference feature and agent skills. The foundation preset defines `projects.enabled`, `projects.max_active`, and membership capacity without provider credentials. These are working local policies and database enforcement, not fake billing confirmations. Commercial core adds provider-confirmed plan/seat sources, windowed usage, notices, and customer administration. Disabling a provider module never disables declared quota or authorization enforcement.

## 4.2 Billing architecture and ownership

Default commercial mode: free/trial tiers plus Stripe fixed and seat subscriptions. Use hosted checkout and customer portal for payment details. The application stores provider references and local access state, not card information.

Own stable plan keys and immutable plan versions. Provider price IDs are environment-specific mappings, not application feature names. Existing subscribers retain their sold version until an explicit migration. Validate selectable prices, currency, organization, and quantities server-side.

Stripe subscription events cover asynchronous payment and lifecycle changes. Integrate verified events and reconciliation rather than treating a browser redirect as proof of payment. [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)

Proposed normalized access policy:

| State | Product policy |
| --- | --- |
| Free | Only free-plan features and limits |
| Trial | Explicit trial entitlements until recorded expiry; abuse controls and conversion notices |
| Pending/incomplete payment | No newly purchased entitlements until provider confirmation |
| Active | Current plan/contract entitlements |
| Past due | Configurable, time-bounded grace; reminders and restricted purchasing/expensive work |
| Grace expired / unpaid | Paid mutations disabled; documented read/export/recovery access preserved where applicable |
| Cancel scheduled | Access through the paid-through date; display effective cancellation date |
| Canceled/expired | Fall back to documented free or read-only state; do not delete customer data automatically |
| Security suspended | Security policy overrides billing access immediately |

Every transition records reason, source event/command, effective time, and audit reference. Do not map all provider statuses to a single `is_paid` boolean.

### Billing changes and incoming events

1. An authorized billing manager requests checkout/change/cancel with a scoped idempotency key and server-validated price/quantity.
2. Persist the command and call the provider outside the domain transaction, using a stable provider idempotency key.
3. Verify incoming webhook signatures over raw request bytes, persist a durable inbox record, and acknowledge promptly after durable acceptance.
4. A worker serializes updates per provider subscription/account, fetches current provider objects where needed, and derives local state. Do not rely on arrival order or event timestamp alone to decide truth.
5. Atomically update the billing projection, invalidate entitlement snapshots, write audit/outbox events, and mark processing progress.
6. Reconcile outstanding commands and provider state on a schedule, including after outages. Expose unresolved discrepancies to operators.

Stripe documents raw-body signature verification, duplicate delivery, retries, and lack of guaranteed event order. Keep replay handling idempotent and use the selected API/event version consistently. [Stripe webhook documentation](https://docs.stripe.com/webhooks)

Never accept a caller-supplied customer ID as authority to administer a customer. Resolve provider objects from the trusted organization's billing account. Provider-wide webhooks resolve tenant identity from that mapping before tenant data access; unknown mappings are quarantined for reconciliation.

### Seats, upgrades, and contracts

- Default seat model: purchased capacity. Active owners/admins/members consume seats; pending invitations do not. Billing-only memberships and guests have explicit configurable classifications.
- Every transition into or out of billable membership uses one transactional admission service. Invitation acceptance, SCIM creation/reactivation, manual reactivation, role/classification changes, ownership transfer/recovery, and initial owner bootstrap all compute the old/new billable delta through this boundary. No transport, directory adapter, or operator command writes occupancy directly.
- Acquire all fences and rows through the [canonical lifecycle lock order](03-data-model.md#canonical-lifecycle-lock-order), including user lifecycle fences before organization locks. For a positive delta, require `occupied + delta <= effective capacity`; atomically persist membership, occupancy, idempotency receipt, authorization revision, audit, and outbox. Nonpositive deltas remain possible while over capacity. Two transitions through different entry points cannot claim the same final seat.
- Foundation capacity comes from the local policy catalogue; commercial capacity comes from confirmed provider state or an effective contract. Bootstrap creates the capacity row and admits the first owner in the same transaction, and refuses to expose a usable tenant if admission fails. A verified owner-recovery replacement uses the same rule; capacity changes require an explicit authorized policy/contract action.
- Buying seats completes only after the provider confirms the quantity. Capacity and current active seats are distinct values.
- Application-requested decreases cannot reduce purchased capacity below active eligible memberships. Schedule a decrease after administrator-selected offboarding. Disable provider portal quantity changes unless the adapter can enforce the same rule. An external/provider-console downgrade can still cause a discrepancy: record actual confirmed capacity, block positive admission deltas, notify administrators, and reconcile without silent employee removal or invented purchased seats.
- Deprovisioning always removes access and releases occupied capacity exactly once; a billing outage, pending quantity command, or sole-owner condition cannot block it. SCIM activation with insufficient capacity remains inactive/pending with a documented adapter error/retry contract; it never grants access and repairs the counter later.
- Preview proration and effective dates through provider APIs. Default upgrades can be immediate after confirmation; downgrades take effect at renewal.
- Contract mode supports manually approved entitlements, effective dates, invoice terms, and renewal metadata. Avoid creating both manual and self-service charges for the same obligation.
- Taxes, refunds, credits, disputes, and accounting exports use provider capabilities and explicit operator workflows. Product launch chooses jurisdiction-specific settings and retention; the template does not certify compliance.

Seat acceptance evidence includes invite-versus-reactivation, invite-versus-SCIM, concurrent billable role changes, owner bootstrap/recovery, repeated deactivation, and a provider downgrade racing with admission. Recompute occupancy from eligible memberships during reconciliation. Test the local transition service in Foundation, provider races in Commercial core, and the real SCIM adapter in Enterprise.

## 4.3 Entitlements and quota semantics

Define typed features: boolean (`exports.enabled`), integer capacity (`projects.max_active`), recurring usage (`api.requests_per_period`), or configuration (`audit.retention_days`). Distinguish missing, disabled, zero, and unlimited values.

Resolve entitlement snapshots deterministically from the sold plan version, add-ons, and effective contract overrides. Cache by organization and source version with explicit expiry. During provider outage, honor an existing confirmed snapshot only through its documented validity/grace policy; never create new paid grants from a failed request.

Quota modes:

- **Capacity:** active projects, occupied seats, stored bytes. No monthly reset; decrement only when the resource truly leaves the counted state.
- **Windowed consumption:** requests or processed items in `[period_start, period_end)`. Record which clock and billing/calendar anchor applies.
- **Rate limit:** short-window burst/abuse control per organization, principal, endpoint, and/or source IP. Separate from purchased monthly allowance.
- **Soft allowance:** permit measured overage and notify only when the contract permits it. A UI warning never replaces server enforcement.

Use an atomic conditional update or row lock to reserve units. Identify each reservation by operation, track reserved/committed/released state, and give abandoned reservations an expiry. Mutations that fail before consumption release the reservation; expensive external work that incurred a real charge is finalized according to the metric contract even if the client disconnected. Retries use the same operation ID.

Configure notification thresholds such as 80%, 95%, and 100%, deduplicated per metric/window/threshold. Values are product defaults, not hard-coded assumptions.

## 4.4 Usage ledger and optional metered charging

Each metric declares its unit, exact billable trigger, aggregation, accepted dimensions, event-time policy, corrections, and failed/canceled-operation treatment. Example: `exports.completed` counts a successfully generated export once; it does not count every download retry.

Record organization, unique source operation/event ID, metric/version, exact quantity, occurrence and receipt times, and approved dimensions. Commit the event with the business transaction when possible. Rebuild aggregates from the ledger and compare aggregate versions/watermarks. For high-volume ingress, acknowledge only after durable persistence; use batching and a dedicated ingestion service when measurements justify it.

Local usage supports operational visibility, quotas, and evidence of consumption. An external usage-billing system can own rating and invoice calculations. Reconcile event delivery, provider aggregation, credits/adjustments, and invoice totals; show customers whether figures are actual usage, a cost estimate, or a finalized invoice.

**Provider decision:** retain a `UsageBillingProvider` interface. The researched Stripe recording-usage page now recommends Metronome for new usage-based integrations and describes Billing Meters as the path for existing integrations. Therefore the plan does not hard-wire a new product to the older meter-event flow. Evaluate Metronome as the first optional adapter; verify contract access, integration scope, limits, and cost in Phase 0. Existing Billing Meters customers can use a separate compatibility adapter. [Stripe usage-recording guidance](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage)

That provider change does not remove the need for local real-time admission control or durable operation IDs. The template must remain runnable with a fake usage-billing provider and without paid metering credentials.

For hybrid subscriptions, assign each base fee, seat fee, and usage charge exactly one rating/invoicing owner. The adapter contract must prove that retries or overlapping Stripe/Metronome configurations cannot bill the same charge twice.

Late/corrected usage rules:

- Store event and receipt time separately; use explicit half-open billing periods and test boundaries/time-zone changes.
- Deduplicate in the local ledger for the required retention horizon, independent of a provider's shorter deduplication window.
- Use versioned adjustment events linked to originals. Do not rewrite history silently.
- When a provider's accepted backfill window closes or an invoice is finalized, use an explicit adjustment/credit process instead of resending altered historical usage.
- Keep a retry/dead-letter ledger and a watermark for confirmed delivery. Provider downtime must not lose consumption history.

## 4.5 Audit and security events

Audit events answer who did what, to which organization/resource, when, through which channel, and with what outcome. Include the actual operator and effective customer actor during support sessions.

Audit at least: sign-in/security changes, organization lifecycle, invitation/membership changes, resource mutations/sharing, API-key lifecycle, SSO/SCIM/security policies, billing/entitlement changes, exports, integration credentials, deletion requests, operator actions, and audit exports themselves.

- Successful business changes and their audit entries commit together. A required audit write failure aborts the mutation.
- Failed/denied actions go to a separate durable security sink/transaction so rollback does not erase them. Explicitly define fail-closed behavior for privileged actions when this sink is unavailable.
- Runtime credentials may append to audit tables and read authorized views but cannot update/delete audit history. Dedicated retention jobs use separate credentials and documented policies.
- Redact passwords, tokens, secrets, full payment data, and unnecessary personal data. Use an allowlist for before/after field changes.
- Query/export access has a dedicated permission; ordinary activity feeds expose a smaller subset.
- Append-only permissions protect against ordinary application modification; they do not make records immutable against database administrators. Optional externally retained/WORM exports and integrity verification strengthen tamper evidence.

Provide a suggested retention configuration, not a universal legal rule: short operational-log retention, longer tenant audit retention, and separate financial retention. Tenant contracts can override permitted values. Deletion and legal-hold policies must reconcile these categories explicitly.

## 4.6 Jobs, notifications, files, and integrations

### Durable work

Outbox events are committed with domain changes. A dispatcher claims work, submits a job with a stable event key, and records dispatch progress. A crash between enqueue and acknowledgement may replay; every consumer uses a unique receipt plus idempotent provider operations. Claiming a job is not proof of exactly-once external effects.

Use bounded retries with exponential backoff/jitter, timeouts, cancellation, heartbeat/progress, per-tenant fairness, and a dead-letter view. Reauthorize user-requested exports/imports at execution and download. Enforce ordering only where the aggregate requires it. Include job IDs and request IDs in traces.

### Notifications

Email/in-app templates are versioned and localized, with preferences, unsubscribe handling for optional messages, bounce/complaint handling, deduplication, and a delivery history. Security and billing notices have explicit mandatory/optional classifications. Local development uses a mail capture service; automated tests do not contact customers.

### Search and resource activity (Commercial core)

Foundation's Project search filters the authorized Project list. Phase 6 adds a cross-resource PostgreSQL search service and dashboard entry over explicitly registered resource types. Each type declares searchable fields and safe snippets; results, continuation cursors, counts and relation links obey [the shared list/field policies](02-architecture-and-security.md#lists-counts-and-field-policies). Index updates are idempotent and deletion-aware; stale index entries never bypass current resource permission or lifecycle checks. Acceptance includes overlapping tenants, sparse grants, revoked access, disabled resource types and deletion, including snippet/count leakage cases.

Resource activity is a separate customer-facing projection of versioned, allowlisted domain events into `activity_events`, with stable source IDs for deduplication. Read access follows current resource permissions and returns safe actor labels/payloads; restricted audit/security records are not copied wholesale into the feed. Phase 6 ships a resource-detail feed, bounded pagination, replay and ordering tests, redaction, deletion/retention handling, and denied/revoked-resource tests. Security audit remains required even when activity feeds are disabled.

### Files and bulk data

Upload lifecycle:

1. Authorize the resource, reserve capacity, and create an idempotent upload attempt. Issue a constrained URL for a private **staging key** only; upload credentials cannot write the finalized namespace.
2. The trusted finalizer captures the staged content into a fresh immutable quarantine object, using a pinned source version when available. Verify size/type/digest on the captured object. Never approve a mutable staging key or copy unverified bytes after a scan.
3. Scan that exact captured object. Bind the scan result to its final key, immutable version when applicable, byte length, and digest. A rejection remains unavailable and follows the cleanup policy.
4. Recheck current authorization, lifecycle, and reservation validity. Atomically record the immutable file identity, mark it available, settle actual capacity once, and append audit/outbox. Finalization retries return the same committed file; abandoned candidates are cleaned up. If the reservation expired, reacquire capacity before publication.
5. Downloads resolve only the recorded approved object/version after a current resource-access check. No client parameter can substitute another key/version, and subsequent uploads cannot replace the approved bytes. Replacements start a new upload and scan lifecycle.

The storage adapter must prove create-once finalized keys or pinned immutable versions across copy/scan/download. A provider without either guarantee cannot enable uploads. S3 presigned URLs can be reused until expiry and can overwrite the same key, so short expiry alone does not protect the scan result. [AWS presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

Expire abandoned objects and release reservations; account for quarantine and retry-object storage so staging cannot bypass storage budgets. Downloads use short-lived links with a documented maximum revocation window after issuance; products requiring authorization on every new download request use a proxy. File tests overwrite staging before/during/after scanning, replay finalization concurrently, forge a version/key, and race reservation expiry or permission revocation with publication. None may serve unscanned replacement bytes or settle capacity twice.

CSV import includes mapping, dry-run validation, duplicate rules, row-level errors, idempotent chunk processing, and progress. Export uses the requester's current permitted data and authorized fields, prevents spreadsheet-formula injection, expires objects, and audits creation/download. Large transfers are worker jobs, never unbounded HTTP requests.

### Outgoing webhooks and integrations

Sign the exact body with timestamped HMAC, include an event ID/schema version, rotate secrets with overlap, retry safely, and expose delivery diagnostics. Verify endpoint control and prevent SSRF: allow HTTPS destinations, reject private/link-local/metadata addresses, revalidate DNS at connection time, and validate redirects or disable them. Tenant endpoint configuration does not authorize access to internal networks.

Encrypt integration credentials using managed keys, scope them minimally, and support token refresh, revocation, reconnection, and provider rate limits. Apply current tenant permissions to integration actions and payloads. Allow only documented event fields; never transmit arbitrary database rows.

## 4.7 Security, observability, and image verification

Provide disposable local containers for PostgreSQL, OpenFGA with its own database, an S3-compatible service, and mail capture for application tests.

The [CI and Docker image plan](07-ci-and-docker-image.md) specifies source checks, the combined web/worker image, packaged one-off commands, health checks and worker draining.

Use LogTape for structured application and worker logs, with OpenTelemetry for traces and metrics. Include request, tenant, actor reference, event, job, and external operation IDs with shared redaction before output. Exclude credentials, tokens, authentication URLs and sensitive payloads. Avoid organization IDs as unbounded metric labels; use logs or sampled traces for per-tenant diagnostics. Collect latency/error rates, DB pool saturation, slow queries, authorization denial/unavailability, projection lag, queue backlog, webhook failures, quota conflicts, and billing discrepancies.

Proposed application acceptance targets, to be measured against a documented synthetic workload:

| Target | Application benchmark objective |
| --- | --- |
| CRUD API latency | p95 reads under 500 ms; writes under 800 ms at the reference load |
| Reference dataset/load | 100 tenants, 1,000 memberships, 100,000 resources; 50 concurrent clients; hot-tenant distribution and request mix specified below |
| Authorization readiness | Healthy p95 under 2 seconds: through generation activation for historical projection, or through acknowledged source commit for synchronous contextual authorization; report graph writes/attempts explicitly, including zero |
| Create-to-readable | Healthy p95 under 2 seconds from create submission to the first authorized read of its committed resource, including projection/retries |
| Authorization fence wait | Healthy p95 under 100 ms; report p99/max and revocation-writer starvation |
| Healthy eligible requests | At least 99.9% succeed without projection-induced `503` or lock timeout in the benchmark; report first-attempt and eventual results separately |
| Usage visibility | Healthy event-to-dashboard p95 under 60 seconds; hard quotas enforced transactionally |

These are engineering targets, not capacity claims or contractual SLAs. Load-test sparse authorization lists, import/export contention, noisy tenants, and provider outages. Set budgets for pools, timeouts, event sizes, and per-tenant work.

### Phase 0 authorization decision gate

Before committing to the authorization protocol, run a minimal prototype with real PostgreSQL/OpenFGA and the reference dataset. After warm-up, sustain at least 30 minutes with 50 concurrent clients: one organization owns half the resources and receives 80% of traffic; the request mix is 60% reads/lists, 20% ordinary updates, 10% resource creates/deletes, and 10% sharing/revocation/parent changes. Include a principal who can read only 1% of hot-tenant candidates and concurrent work in other organizations. Record achieved request rate, hardware, pool sizes, limits, graph/tuple sizes, and all retry policies so results are reproducible.

- Healthy runs must meet the CRUD, authorization-readiness, create-to-readable, fence-wait, and eligible-request targets above. Deliberate authorization denials are counted separately; an otherwise authorized request rejected because projection is stale counts as an availability failure.
- Report first-attempt failures, eventual outcomes, p95/p99/max lock waits, end-to-end revocation latency, generation build/cleanup cost, and abandoned-build rate. Ordinary creates with initial manager grants are authorization changes; measuring share-only traffic is insufficient.
- Run a separate fault suite for database-fence loss, remote timeouts, delayed old writes or allowed responses arriving after a newer revocation, FGA outage, sparse-list contention, and recovery. For the contextual candidate, also prove stored-policy parity, request-namespace isolation, context bounds and expiry. Retain the historical projector duplicate-work/abandoned-publication tests. Assert zero obsolete grants, no publication by an abandoned attempt, bounded queues/timeouts, and eventual recovery after dependencies return. Record recovery time and set the acceptable recovery budget in the Phase 0 ADR before approving the protocol.
- Phase 0 exits only with recorded correctness and availability evidence. If the candidate fails, redesign and rerun these gates before Phase 2; do not conceal failures with retries, relaxed revocation, or a lower undocumented workload. Phase 2 implements the minimum production protocol for identity/organization operations; re-run on the real Project feature before Phase 4 and against the built image during hardening.

GitHub Actions installs dependencies with Bun and checks Biome formatting/lint, TypeScript, Commitlint conventions, Knip cleanup/dependency boundaries, Vitest unit/integration suites, Playwright end-to-end suites, Storybook builds, migration upgrades, OpenFGA model assertions, agent-authored feature behavior, dependency/secret scans, and production builds. Lefthook runs local checks under the same policies; CI remains authoritative. See [CI §7.2](07-ci-and-docker-image.md#72-continuous-integration) for command contracts. Skill behavior evaluations run separately in isolated fixture environments and supply versioned release evidence; routine application CI does not call a live AI service.

Package explicit migration commands and test compatibility against previous-release fixtures. Retain dependency update policy, license inventory and application reconciliation/deletion diagnostics.

## 4.8 Export, deletion, and recovery lifecycle

### Organization deletion

1. Authorize/reauthenticate the requester, record scope and retention constraints, and offer export before deletion.
2. Persist an idempotent deletion intent and suspend new tenant writes/integrations; revoke credentials/support sessions. Append the tenant ID, request ID, effective/grace dates, and retention scope to the independently durable deletion journal. Acknowledge deletion as scheduled only after that journal write is confirmed. An unavailable journal leaves the request pending and blocks purge; reconciliation resumes interrupted intent/journal updates.
3. Cancel or settle billing according to the subscription/contract; avoid treating successful data deletion as proof that a provider subscription was canceled.
4. Purge eligible tenant tables, files, caches, search indexes, queued payloads, graph tuples, and organization-scoped analytics/provider copies through a resumable workflow. Preserve only explicitly retained records with restricted access.
5. Append deletion progress/completion to the independent journal and retain a minimal local receipt/manifest. Journal permitted cancellation and retention changes before restoring access or changing purge scope. Keep only the identifiers and lifecycle evidence required to replay the decision; journal retention covers every restorable backup plus the replay window.
6. Deletion status describes confirmed application/provider cleanup; it does not claim that historical backup copies have expired.

### Personal account deletion and ownership continuity (Commercial core)

This closes a global user identity across all organizations. It is distinct from employee deprovisioning in one tenant and from deleting an organization.

1. Require recent authentication appropriate to the user's available method and applicable policy; support passwordless-only accounts. Show memberships, organizations requiring a successor, resource responsibilities, and retained-record categories. Offer an own-account data export without exposing other members' data. Record an idempotent request in `awaiting_prerequisites`; it is not yet a scheduled deletion.
2. Complete ownership resolution for every organization. Where another active owner remains, confirm continuity. Otherwise use the accepted ownership-transfer flow, or separately authorize and finish organization deletion. Nomination alone is insufficient. Transfers persist independently if the user later abandons account deletion; list their outcome clearly and never silently reverse them.
3. Revalidate all memberships and ownership obligations under the shared lifecycle lock order. Freeze the identity and record the local deletion intent; deny new sign-in, user-authorized work, memberships, and ownership acceptance. Append the account subject, affected organizations, accepted ownership-resolution receipts, effective dates, retention scope, and provider cleanup obligations to the independent journal. Mark scheduled only after acknowledgement. Journal failure leaves the account frozen with a pending status and retries; it cannot report success or start irreversible purge.
4. Revoke sessions, passkeys, authentication-provider credentials, magic/reset/recovery challenges, and support sessions for that identity. Remove membership/team/resource grants through idempotent transitions and reconcile seats. Reassign resource responsibility without deleting shared tenant content. Continuing organizations keep their subscriptions, invoices, service accounts, and other members' access. Remove personal external connections/secrets and replace the departing user's billing contact as required.
5. Purge or anonymize eligible profile data, avatars, preferences, private account exports, and derived caches/search/queued payloads. Preserve only explicit retention exceptions and restricted, non-login historical actor references. Append-only audit history follows its existing separate retention policy; record the identity-to-history treatment without rewriting financial or security evidence ad hoc.
6. Suppress analytics for the account, cancel queued events, request provider subject deletion, and reconcile acknowledgement before marking that part complete. Product use remains available to continuing tenants during provider outages. Delayed provider writes and deletion retries must converge without recreating the analytics subject; §4.9 defines the delivery barrier.
7. Record per-step completion in the journal. Report `purging`/provider-pending/retention-limited status accurately through a narrowly scoped deletion-status receipt or notification channel that grants no product access. Complete only after required local/provider work is confirmed; distinguish retained categories and backup expiry. Cancellation is supported only while awaiting prerequisites, before confirmation/freezing. After confirmation the account stays unavailable while deletion finishes; do not restore credentials or replay old memberships. A future post-confirmation grace/cancellation feature requires a separate recovery and re-admission design.

Required tests cover multiple organizations, accepted/expired/canceled transfers, inactive or deleting successors, concurrent ownership/SCIM changes, passwordless reauthentication, interruption/retry, final-seat races, analytics outages/late events, and a restore from before ownership transfer and account deletion. Security deprovisioning may still leave an organization in audited owner recovery; it never waits for voluntary transfer requirements.

### Recovery readiness protocol

The deletion journal and recovery epoch/readiness record must survive independently of application and OpenFGA database restores, with separate access controls and completeness verification. A tombstone existing only inside the restored backup cannot represent a later deletion. A missing or unverifiable journal must keep tenant serving gated.

This section is the authoritative application recovery contract (`R-RECOVERY`). The deletion journal does not record every membership removal, grant revocation, credential rotation, or security-policy change. Therefore an application-database restore uses mandatory security revalidation, not an assumption that restored permissions are current:

- Invalidate every restored session, API key, support session, sign-in/reset/recovery challenge and authentication credential, including passwords, passkeys, MFA recovery material and linked-provider credentials. Re-enrollment requires independently verified identity/current IdP evidence and the applicable tenant policy; a restored email address or a fresh login with a restored credential is insufficient. Rotate/revalidate integration credentials before resuming provider effects.
- Treat restored memberships, teams, role assignments, resource grants, inheritance/parent relationships, and tenant identity/security settings as unverified. Recover organizational authority through the existing audited owner-recovery command using evidence outside the restored application snapshot. A verified owner then explicitly approves the current membership and access configuration through recovery services; current IdP/directory evidence may automate only the scopes it authoritatively owns. Never auto-approve a restored grant or weaken a restored security policy for convenience.
- Retain revalidation evidence in the independent control plane, bind approvals and newly issued credentials to the fresh epoch, and admit approved memberships through the normal seat boundary. Unverified principals/relationships remain denied and excluded from the rebuilt graph. An organization without a verified owner stays in owner recovery; other verified organizations may resume once the application-wide replay and validation gates pass.
- If only FGA was restored and the application database is proven current and intact, attest its current security/credential state to the new epoch and use it to rebuild the graph; blanket credential replacement is unnecessary. This attestation is permitted only for the intact application store and is recorded independently. An uncertain application recovery point uses the stricter application-restore path. Any future automatic preservation of restored access requires an independently complete security-change history and a separately proved replay protocol.

1. Close the application readiness gate for tenant routes, APIs, workers, integrations, and provider effects. Stop or isolate old processes/credentials and allocate a fresh recovery epoch in the independent control plane. Keep only narrowly authorized recovery diagnostics available.
2. Restore application data and treat all saved authorization readiness, generation pointers, revision equality, and cached permissions as unverified. Application and FGA snapshots can be from different times; restoring just one still requires this procedure.
3. Read the complete independent journal through a verified watermark and replay lifecycle state, grace/cancellation decisions, retention exceptions, and completed deletions. Catch up new journal entries under a coordinated readiness barrier before release. Purge/suspend restored organizations and global accounts as required, including objects, queues, credentials, graph data, and analytics mappings. Replay accepted ownership-resolution receipts and revalidate surviving owners; an unresolved or deprovisioned successor enters owner recovery. Never restore deleted-user access or cancel a continuing organization as a shortcut.
4. Apply the security revalidation rules above, reconcile external billing commands/capacity, and clear restored permission caches. For contextual authorization, reconstruct request contexts solely from independently approved current security state using the pinned model and rotated recovery epoch. Verify the matching context compiler before releasing readiness; no persisted permission graph needs rebuilding. Any retained full-copy implementation must instead rebuild into fresh namespaces and must never reactivate a pre-restore generation. Recovery commands use dedicated control-plane authorization while ordinary traffic and jobs remain gated; reconcile occupancy from approved active memberships without duplicating seat transitions.
5. Verify source revisions, acknowledged graph manifests, tenant/resource allow/deny cases, credential invalidation and revalidation evidence, deletion completeness for both subject types, analytics suppression/deletion, and pending provider effects. Record which organizations remain in owner recovery and atomically release application readiness only for the verified epoch. Unverified organizations and integrations remain gated. Errors keep the affected gates closed; changing revision counters alone cannot repair readiness.

Commercial core acceptance must demonstrate the recovery contract with synthetic fixtures; deletion cannot be marked complete without verified journal evidence. Required scenarios include mismatched snapshots, FGA-only restore, account/organization deletion or ownership transfer after backup, journal outage/incomplete replay, interrupted rebuild, and an old projector request completing during recovery. Also revoke a membership, direct/team/inherited grant, API key and passkey after backup, then restore that backup: none may regain access before independent revalidation/replacement. Verify current directory evidence, rejection of restored-only evidence, seat reconciliation, and continued denial for an organization lacking verified authority. Enterprise hardening expands the synthetic recovery fault suite; no operational recovery-time commitment is part of template acceptance.

Full-database recovery is the default drill. Single-tenant restoration from a shared database is a separate export/import procedure using the same deletion-journal and authorization-readiness gates, referential validation, billing reconciliation, and collision checks; it is not a simple SQL rollback.

## 4.9 Product analytics

Ship product analytics in Commercial core through a provider-independent adapter and a reference PostHog integration. Collection is disabled until configured. Local development uses synthetic events and a local test sink. Provider configuration and published report definitions are part of the module; a tracking SDK alone does not satisfy the feature. [PostHog integration example in next-forge](https://www.next-forge.com/docs/packages/analytics/product)

### Events, attribution, and reports

- Maintain a versioned, typed event catalogue: `account.signed_up`, `organization.created`, `onboarding.completed`, `core_action.completed` with an allowlisted feature key, and `subscription.paid_started`. Add feature-specific events through the same catalogue. Successful business events originate after commit with stable operation/event IDs; UI views and clicks are explicitly non-authoritative.
- Derive authenticated user/organization scope from server context and use opaque provider identifiers. Organization switching must change attribution without leaking data from the previous tenant. Do not merge identities merely because emails match. Anonymous marketing tracking is outside the initial product-analytics scope; any future identity merge needs a separate consent/attribution design.
- Supply saved reports or a restricted analytics page for onboarding completion, activation, feature adoption, paid conversion, and retention. Document metric unit, denominator, window, time zone, cohort rules, deduplication, and ingestion delay. Default activation is an organization's first successful core action within seven days of creation; weekly retention is a later week's core action by an organization in that activation cohort. Feature adoption counts distinct active organizations per feature/week. User signup/onboarding and organization activation are different units and cannot silently share a denominator.
- Paid conversion counts the first provider-confirmed paid subscription/invoice for an organization, excluding trials, free plans, and checkout redirects. Record corrections when reconciliation changes that classification. These reports are analytical estimates and never the financial ledger, entitlement authority, or quota counter.
- Initial cross-tenant reports are operator-only, using a restricted analytics view/provider role in C. The full tenant-support/operator console still arrives in E. Any later customer-facing report is organization-scoped and independently authorized. Exclude synthetic fixtures and support impersonation from product adoption statistics.

### Tracking controls and delivery

Apply application settings plus organization and user preferences; collection requires every applicable scope to permit it. `analytics_preferences` is the sole writable authority for user/organization choices; account and organization settings screens call its service. Any displayed/cached projection carries its policy version and cannot override it. Enforce controls before capture/enqueue and before retry/delivery. Publish an allowlist of event properties and retention settings. Exclude emails, names, free-form content, tokens, auth URLs, and sensitive resource fields. Automatic capture and session replay remain disabled. Operational/security logs and mandatory usage records retain their separate policies.

Use a bounded analytics queue, explicit delivery timeout/expiry, and stable IDs. Provider outages expose diagnostics without failing sign-in, CRUD, checkout, audit, or billable usage recording. Keep analytics traffic and credentials separate from the financial ledger and critical outbox consumers. A provider adapter must document its deduplication and deletion semantics; do not claim exactly-once remote delivery without evidence.

Deletion creates a durable suppression barrier, drops queued events for the subject, and fences new dispatches. Drain or resolve in-flight delivery before the provider deletion request; an ambiguous late write requires repeated deletion/reconciliation before completion. Keep minimal suppression/deletion receipts independently of analytics payload retention so retries or restores cannot recreate erased subjects. If the provider cannot establish deletion completion under delayed delivery, keep cleanup pending and disable that adapter for the release. Organization deletion removes that organization's analytics scope without deleting a member's independent data in other organizations; account deletion removes its personal analytics subject across all scopes.

Acceptance requires correct multi-tab/organization attribution, replay deduplication, report/cohort fixtures, preference changes before retry, property redaction, disabled-provider operation, bounded outage behavior, account and organization deletion, and deletion-after-backup/late-delivery tests.
