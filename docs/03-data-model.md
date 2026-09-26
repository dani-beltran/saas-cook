# 3. Data model

## 3.1 Conventions

This is a logical schema specification. Implementation will translate it into Drizzle definitions, generated SQL, custom policies, and migration tests. Identity-provider and queue tables must follow the selected packages' actual schemas.

- Use application-generated UUIDs for public identifiers. IDs must be opaque; secrecy of IDs is never an authorization mechanism.
- Tenant-owned tables require `organization_id NOT NULL`. Global identity/control-plane tables are an explicit reviewed exception.
- Use `timestamptz` in UTC for instants and explicit IANA time zones for presentation/schedules. Store date-only values as dates.
- Most mutable business rows have `created_at`, `updated_at`, `created_by`, `updated_by`, and integer `version`. Soft deletion is opt-in per entity through `deleted_at` and `deleted_by`.
- Represent money as integer minor units plus currency, with currency-aware exponents. Represent fractional measured quantities as fixed-precision decimals and serialize them as strings; never use binary floating point for money.
- Use native columns for stable business fields. Reserve validated JSONB for versioned settings, metadata, and event payloads with documented size limits.
- Index tenant query paths first: `(organization_id, ...)`. Partition only after measured volume justifies it.

## 3.2 Relationship overview

```mermaid
erDiagram
    USER ||--o{ MEMBERSHIP : joins
    ORGANIZATION ||--o{ MEMBERSHIP : contains
    ORGANIZATION ||--o{ TEAM : owns
    MEMBERSHIP ||--o{ TEAM_MEMBER : participates
    TEAM ||--o{ TEAM_MEMBER : includes
    ORGANIZATION ||--o{ WORKSPACE : groups
    ORGANIZATION ||--o{ PROJECT : owns
    PROJECT ||--o{ TASK : contains
    ORGANIZATION ||--o| BILLING_ACCOUNT : pays
    BILLING_ACCOUNT ||--o{ SUBSCRIPTION : tracks
    ORGANIZATION ||--o{ ENTITLEMENT_OVERRIDE : negotiates
    ORGANIZATION ||--o{ USAGE_EVENT : consumes
    ORGANIZATION ||--o{ AUDIT_EVENT : records
    ORGANIZATION ||--o{ RESOURCE_GRANT : grants
```

The diagram shows logical relationships, not exhaustive SQL constraints. Polymorphic grant targets need a resource registry or service-validated lifecycle; a text `resource_type/resource_id` pair does not by itself provide referential integrity.

## 3.3 Identity and organization tables

| Table or group | Essential data and rules |
| --- | --- |
| `users`, `auth_accounts`, `sessions`, `verification_challenges`, `mfa_credentials` | Identity-adapter records; global account lifecycle status/fence, verified identities, session method/assurance and expiry/revocation; hashed single-use magic-link challenges; never expose full rows as DTOs |
| `passkey_credentials` | Adapter-owned WebAuthn credential ID/public key, user handle, counter/device metadata, user-facing name and timestamps; unique credential ID; no private keys; enrollment/revocation audited |
| `user_preferences` | User, locale, time zone, theme; own-user access only; analytics choices are owned exclusively by `analytics_preferences` |
| `ownership_transfers` | Organization, initiating/recipient memberships, requested outgoing role, ownership version, expiry, pending/accepted/canceled/expired state, acceptance and audit receipt; same-tenant foreign keys, one active transfer per outgoing ownership |
| `account_deletion_requests`, `account_deletion_org_steps` | Global requester, idempotency key, reauthentication evidence reference, awaiting_prerequisites/frozen/purging/complete state, per-organization ownership resolution/transfer receipt, cleanup progress and journal receipt; own-user or restricted lifecycle-service access |
| `organizations` | ID, unique routing slug, display name, status including `owner_recovery_required`, locale, time zone, deletion scheduling; an explicitly controlled registry table |
| `memberships` | Organization, user, status, baseline role, billable classification, joined/suspended timestamps; unique `(organization_id, user_id)` |
| `invitations` | Organization, normalized destination identity, token hash, requested membership, inviter, expiry, acceptance/cancellation; single-use atomic acceptance |
| `teams`, `team_members` | Organization, team name/slug; membership references with same-tenant constraints; no nested teams in first release |
| `workspaces` | Organization, name/tenant-unique slug, archived state and version; optional Phase 3 subdivision module; registered target for inherited grants |
| `organization_settings`, `security_policies` | Typed settings and security requirements, policy version; organization-wide changes audited |
| `verified_domains` | Organization, hostname, verification challenge/status/expiry; uniqueness and takeover protection |
| `sso_connections`, `directory_connections`, `directory_subjects` | Organization-scoped provider mappings, encrypted credentials, external stable subjects, sync state, source ownership |
| `service_accounts`, `api_keys` | Organization, lifecycle status, explicit grants; key prefix/hash, scopes, expiry, last-used timestamp; secrets shown only once |

Prevent voluntary removal/demotion/suspension of the final active owner under concurrent requests using an organization-level lock. Trusted security/SCIM deprovisioning overrides this rule: deactivate the membership and atomically enter `owner_recovery_required` if no active owner remains. Deny ordinary tenant operations until the dedicated, audited recovery command verifies organizational authority, admits a replacement owner, and publishes current authorization. Do not retain access merely to satisfy an owner-count invariant. Ownership transfer is a dedicated command, not an unrestricted membership PATCH. Invitation tokens, reset tokens, and API keys are never stored in plaintext application logs.

### Canonical lifecycle lock order

This is the authoritative lock-order contract (`R-LIFECYCLE` in the roadmap); billing, identity, recovery, and feature services reference it rather than defining their own order. All membership creation, activation, role/classification changes, and ownership transfers use one transition service. User-authorized commands and membership/ownership transitions first acquire relevant user lifecycle fences in user-ID order (shared for normal work, exclusive for account freeze), then organization locks in organization-ID order: authorization fence → lifecycle/owner row → seat-capacity row → affected memberships. This ordering also applies to invitations, SCIM admission, transfer acceptance, and resource responsibility changes; no path acquires the user fence after an organization lock. Atomically validate lifecycle/owner rules, compute the old/new billable delta, check admission, update membership and occupancy, advance authorization state, and append audit/outbox records. Bootstrap initializes the capacity row and admits the first owner atomically. Deactivation releases occupancy exactly once and never waits on a billing provider or available capacity.

Account closure checks every current ownership obligation under these locks, freezes the global identity, and cancels pending incoming transfers/admissions before releasing the fences. A transfer acceptance conditionally rechecks active recipient/initiator state and expected ownership version in the same transaction as role/seat/audit updates. Use bounded transactions for freeze and per-organization state changes; run external cleanup later. Repeated deletion steps cannot release seats twice. Test closure racing new invitations, SCIM admission, recipient deprovisioning, and reciprocal transfers. Do not cascade-delete tenant resources through a user foreign key; reassign responsibility or retain a restricted historical actor reference.

Global identity access uses narrowly scoped adapters and separate DB privileges. Tenant users must not obtain a global user directory by querying `users`; member listings expose only authorized organization membership projections. Organization creation, slug lookup, and cross-organization membership navigation use explicit control-plane services, not an RLS bypass flag.

## 3.4 Authorization and domain tables

| Table | Essential data and rules |
| --- | --- |
| `resource_registry` | `(organization_id, resource_type, resource_id)`, parent pointer, lifecycle state; allows explicit grants to reference known resources |
| `resource_grants` | Organization, registered target, subject membership/team/service account, relation, expiry, grantor; unique normalized edge; reject cross-tenant subjects/parents |
| `roles`, `role_permissions`, `role_assignments` | Tenant custom-role definitions from a versioned platform permission catalogue; assignments to validated subjects and scopes |
| `authorization_revisions` | One row per organization: source desired/applied revision, evaluation mode, pinned model/store, recovery epoch and verified readiness; contextual publication is the source commit, and restored equality alone cannot authorize access |
| `authorization_projection_attempts` (historical spike only) | Retained for rejected full-copy regression evidence; contextual authorization creates no projection attempts or persisted graph snapshots |
| `projects` | Organization, ID, name, tenant-unique slug, description, status, owner membership, optional workspace reference, version, timestamps; owner/workspace composite foreign keys include organization; optional soft deletion |
| `tasks` | Optional reference extension: organization, ID, required parent project, title, state, assignee membership, version/timestamps |

Use dedicated nullable subject columns with a CHECK requiring exactly one of membership/team/service account, or introduce a typed principal registry. Do not rely on an unconstrained subject string. Register/unregister resources and create/remove their local grants in the same transaction as domain lifecycle changes; contextual authorization reads those committed source relationships directly. Audit/downstream events may still use an outbox; permission availability does not await it.

Every resource table provides a unique `(organization_id, id)` target for child composite foreign keys. For example, `(organization_id, project_id)` in `tasks` references `(organization_id, id)` in `projects`. An owner field references a membership in the same organization. Parent moves require authorization on both locations and a graph revision change.

The actual OpenFGA tuple storage is in its own database and managed by OpenFGA migrations. Application code never writes its internal tables.

The contextual candidate stores its evaluation mode atomically when a fixture tenant is seeded, and advances desired/applied source revisions atomically on authorization changes. Each authorization query uses a new organization/epoch/request namespace without persisting it. The historical projection fixture retains unique, never-reused generation IDs and one active generation per organization. Both are governed by the [architecture §2.6 contract](02-architecture-and-security.md#sources-of-truth-and-revocation), not a separate schema-defined publication sequence.

In the historical full-copy Phase 0 fixture, terminal attempt records retain identity/state/manifest metadata but discard their full tuple arrays. A database trigger makes retired/abandoned states irreversible and clears those payloads in the state-transition transaction. `cleanup_cursors` stores scan progress per endpoint, store and organization scope; cleanup enumerates remote tuples and matches terminal namespaces instead of depending on old snapshots. This is prototype retention machinery, not an approved production migration or metadata-retention policy.

## 3.5 Billing, entitlements, and usage tables

| Table | Essential data and rules |
| --- | --- |
| `billing_accounts` | Organization, billing mode, provider/customer mapping, currency, contacts; one per organization when commercial billing is enabled |
| `seat_capacities` | Organization unique, effective capacity/source revision, confirmed purchased quantity when commercial, active billable occupancy, reconciliation state/version; Foundation uses local policy without a provider account |
| `plans`, `plan_versions`, `prices`, `plan_features` | Global controlled catalogue; immutable sold versions, provider price mappings, feature types/limits |
| `subscriptions`, `subscription_items` | Organization, provider IDs, raw provider status, normalized access state, price/quantity, periods, scheduled changes, last reconciliation |
| `invoices` | Organization, provider ID, currency, amounts, status, hosted invoice reference; projected data, not a custom accounting engine |
| `entitlement_overrides` | Organization, feature, typed value, effective interval, reason, author, optional contract reference |
| `entitlement_snapshots` | Organization, computed feature map, source versions, validity interval, synchronization health |
| `billing_commands` | Organization, operation ID, idempotency key/hash, requested change, provider response reference, completion/reconciliation state |
| `usage_metrics` | Stable key, unit, aggregation semantics, dimensions allowlist, period policy, charging eligibility, schema version |
| `usage_events` | Organization, event ID/deduplication key, metric, quantity, occurred/received timestamps, source operation, dimensions, correction reference |
| `usage_aggregates` | Organization, metric, aggregation version, period start/end, dimensions hash, total, processed watermark; rebuildable |
| `quota_buckets`, `quota_reservations` | Organization, feature/metric, window, consumed/reserved amounts, expiry, operation key, reservation state |
| `usage_deliveries` | Event/batch, provider, stable external idempotency key, acknowledgement/error status, retry state |
| `billing_reconciliations` | Organization, run, expected/observed values, discrepancy type, resolution and audit reference |

Enforce uniqueness for provider objects using provider account/environment plus external ID. Do not assume an ID from a test account belongs to the live environment. Include organization and operation scope in local idempotency constraints. Keep raw provider status separate from application access decisions.

Foundation implements typed local entitlement policies, capacity buckets/reservations, and seat admission with real database transactions. Commercial releases add sold-plan/provider sources and usage windows to the same interfaces. A seat-capacity row can be over capacity after an external downgrade; preserve the observed provider truth, block positive admission deltas, and reconcile without silently removing employees. SQL enforces nonnegative occupancy and transition idempotency; the transition service enforces admission and reconciles occupancy against eligible memberships.

## 3.6 Audit, integration, and operations tables

| Table or group | Essential data and rules |
| --- | --- |
| `audit_events` | Organization where applicable, actor/effective actor, action/version, target, outcome, UTC time, request/trace ID, allowlisted changes, redacted network context |
| `activity_events` | Tenant/resource, source event ID, event type/version, safe actor label and allowlisted customer-visible payload; unique source event per feed projection; current resource authorization required on reads |
| `security_events` | Failed sign-ins, denied access, suspected abuse and platform-level security events; separate read/retention policy |
| `outbox_events` | Event ID, tenant, aggregate, aggregate sequence, type/schema version, payload, timestamp; durable domain-to-worker boundary |
| `consumer_receipts` | Consumer and event ID unique; side-effect state/references; repeated delivery cannot create duplicate business changes |
| `webhook_inbox` | Provider account, event ID unique, signature-verified timestamp, restricted payload, processing state; tenant resolved from trusted mapping |
| `webhook_endpoints`, `webhook_deliveries` | Organization, URL, event allowlist, encrypted signing secrets, rotation state, attempts, response diagnostics |
| `integration_connections` | Organization, provider, external account, encrypted tokens, scopes, expiry, health, revocation state |
| `files`, `upload_attempts` | Organization, registered resource/owner, upload/finalization operation IDs, separate staging and immutable final keys, pinned source/final version when supported, verified bytes/digest/type, scan result bound to exact final object identity, reservation and retention; unique finalization per upload |
| `notifications`, `notification_preferences`, `delivery_attempts` | Recipient and tenant context, template/version, channel, read state, delivery outcome; mandatory security notices handled separately |
| `import_jobs`, `export_jobs` | Organization, requesting actor, source/target file, progress, validation errors, authorization/revision context, expiry |
| `feature_flags`, `flag_rules` | Platform-controlled rollout definitions and targeting; typed values and expiration/owner |
| `support_sessions`, `operator_actions` | Operator, tenant, reason/ticket, approved scope, expiry, effective actor and complete action trail |
| `deletion_requests`, `retention_policies`, `legal_holds` | Organization deletion lifecycle and scoped retention rules; account requests use the separate global lifecycle tables; effective dates, blocked categories, verification and completion manifest |
| `owner_recovery_cases` | Organization, cause, deprovisioned actor reference, evidence/ticket, verified claimant, approver/scope, timestamps and outcome; separate control-plane access |
| `deletion_journal_receipts` | Local projection of independent journal sequence, subject kind (`account` or `organization`), subject ID, request ID, ownership-resolution receipts, effective dates, cancellation/retention/completion and provider cleanup state; never the recovery source of truth |
| `analytics_subjects` | Opaque provider subject mapping and suppression state; restricted access, no global directory exposure |
| `analytics_preferences` | Sole authoritative store for user and organization tracking choices; unique typed scope/subject, allowed/denied value and policy version; own-user or authorized organization administration; no duplicate writable preference in profile/settings tables |
| `recovery_revalidations` | Local projection of independently retained recovery evidence: epoch, organization/principal or relationship, verifier, scope, decision and evidence reference; restored security state is unverified until the current epoch is approved |
| `analytics_deliveries`, `analytics_deletion_jobs` | Versioned allowlisted event, stable event ID, trusted attribution, bounded expiry/retries, provider acknowledgement; separately durable deletion/suppression jobs retained until reconciled |
| Queue-owned tables | Managed by pg-boss in an isolated schema with restricted credentials and operational retention |

Domain and audit timestamps are independent of delivery timestamps. Events use versioned payloads; consumers declare supported versions. Large exports/log payloads live in private object storage with metadata in PostgreSQL.

The deletion journal and application recovery epoch/readiness/evidence records live in a protected control-plane store with an independent recovery lifecycle. Journal IDs/sequences are immutable, writes are idempotent, and retention covers every restorable backup plus the replay window. Journal entries cover account/organization deletion, ownership-resolution receipts and analytics cleanup; they are not a complete history of ordinary access revocations. Recovery records identify restored databases, the journal watermark, independently verified security decisions, graph manifests, and the operator releasing readiness. These are explicit exceptions to application-database ownership. Replay, credential invalidation and security revalidation follow the canonical [operations §4.8 recovery protocol](04-billing-usage-operations.md#recovery-readiness-protocol).

Identity adapters and service-key validation retain issuance/revalidation epoch metadata outside provider-owned fields where necessary. After an application-database restore, credentials and security relationships from the snapshot cannot become valid merely by copying the current epoch onto them; only the recovery protocol can establish new trusted state. Keep denied historical memberships for content references and rebuild active seat occupancy through the shared transition service.

## 3.7 Constraints and indexes

Required starting indexes and safeguards:

- Active domain lists: `(organization_id, created_at DESC, id DESC)`; add declared selective filters/sorts based on real queries.
- Tenant slugs: unique `(organization_id, slug)`, with a documented partial-index policy if reuse after soft deletion is allowed.
- Magic links/WebAuthn: adapter-tested atomic challenge consumption and expiry; unique credential IDs and user-scoped credential inventory.
- Ownership transfers: at most one active request for an outgoing ownership; conditional acceptance/version checks and same-tenant membership references.
- Account closure: unique active request per user and unique `(request_id, organization_id)` step; minimal durable completion receipts; controlled status transitions.
- Analytics: unique event/delivery keys, subject lookup for deletion, delivery expiry and pending deletion scans; analytics queue indexes isolated from financial-ledger indexes.
- Membership lookup: unique `(organization_id, user_id)`; a separate **non-unique** `(user_id, status)` index supports the organization switcher. Test that one user can have active memberships in two organizations while duplicate membership in one organization is rejected.
- Parent traversal: `(organization_id, parent_id, id)`; grant traversal by target and subject.
- Usage: unique `(organization_id, metric_key, deduplication_key)`; aggregation access by organization, metric, occurred time.
- Reservations: unique `(organization_id, bucket_id, operation_key)` and an expiry scan index.
- Seat transitions: unique `(organization_id, operation_key)` receipt; capacity row unique by organization; replayed invite/SCIM/role changes cannot spend or release twice.
- Historical full-copy spike projection attempts only: unique generation ID and `(organization_id, attempt_id)`; index lifecycle state/expiry for abandoned-generation cleanup; active pointer must identify a verified attempt for the current recovery epoch.
- Upload finalization: unique `(organization_id, upload_attempt_id)` and immutable final object identity; scan approval cannot be reassigned to another key/version/digest.
- Audit: `(organization_id, occurred_at DESC, id DESC)` plus deliberate action/actor filters; avoid indexing sensitive JSON indiscriminately.
- Outbox/inbox: status/available-time indexes, event uniqueness, bounded payloads, aggregate sequence uniqueness where ordering matters.
- Large append-only usage/audit tables may later use time partitions. If partitioning changes the scope of a unique constraint, preserve deduplication in a separate non-partitioned key registry or include the correct partition key.

Check constraints validate nonnegative quantities where appropriate, enum states, valid intervals, and exactly-one polymorphic subject. Corrections use explicit typed adjustment events instead of unrestricted negative usage. Relational integrity is enforced in SQL wherever possible, with services adding lifecycle rules.

## 3.8 Migration and deletion policy

1. Schema changes generate ordered SQL and migration metadata. Review indexes, defaults, constraints, tenant policies, and expected lock/runtime impact.
2. Expose migrations as an explicit one-off command with a dedicated role and migration lock. Application replicas do not each attempt DDL on boot.
3. Use expand → run compatible code → backfill in resumable batches → validate → contract. Avoid rewriting large tables in a single request/migration transaction.
4. Keep concurrent-index creation and other non-transactional operations in explicit migration steps supported by the runner.
5. Test both empty-database creation and upgrade from the previous release. Verify RLS with the actual restricted runtime role.
6. Do not edit applied migrations or generate automatic destructive rollback scripts. Prefer forward fixes and tested recovery plans; document incompatible changes before release.
7. Soft deletion does not satisfy permanent deletion. Purge workflows remove domain data, grants, graph tuples, files, derived search data, credentials, and relevant provider mappings according to retention policy.
8. Deleting one organization does not delete a user's independent memberships or another organization's data. Financial/audit retention and legal holds are explicit policy exceptions recorded in the deletion manifest.
9. Personal account deletion removes global credentials and personal data according to policy while preserving continuing organizations and their billing. Ownership obligations must be resolved; historical actor references use the configured retention/anonymization rules. Analytics payloads, subject mappings, and provider copies participate in deletion.
10. Deletion is acknowledged as scheduled only after the independent journal durably records it. A restore keeps tenant serving and workers gated until journal replay, current policy/context reconstruction, and independent security validation complete; local tombstones or matching authorization counters from a backup cannot release that gate.
