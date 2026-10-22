# Phase 6: platform modules and baseline recovery

Status: implementation in progress. The acceptance register remains `docs/06-delivery-roadmap.md`; no Phase 6 gate is accepted by this brief.

## Scope and order

Implement the roadmap's Commercial platform modules: authorization-aware cross-resource search and resource activity; immutable files and bounded import/export; independent deletion journal, account/organization lifecycle and restore revalidation; authoritative analytics controls and bounded delivery; notifications, API-key administration, integrations/webhooks/flags; audit/help/public views. Preserve Phase 5 billing and the existing Foundation boundaries. Optional Backoffice remains separate.

## Access and data decisions

All customer endpoints derive a human actor from the verified session and use the existing tenant transaction, current OpenFGA authorization and final transaction-wide expiry guard. New endpoints reject service principals until explicitly declared and tested. Projects retain their own read/update permissions. Example customer records inherit organization read/manage, matching their existing service. Search has an explicit type registry and exposes only identifiers, type and bounded display labels; no email, description, raw event payload or unrestricted total. Continuations bind actor, tenant and query and advance after the last scanned candidate, including empty pages. Current source and permission checks govern every result.

Activity is a separate allowlisted projection, with stable source-event IDs and current resource authorization on reads. Security/audit records remain independently retained; their arbitrary payloads and actor identifiers are not customer activity DTOs. No customer API may clear independent recovery readiness.

New tenant tables require forced RLS, same-tenant foreign keys and restricted web/worker grants. Applied migrations remain immutable. Fresh/upgrade/replay and revoked/wrong-tenant cases are required. New provider modules remain disabled until their concrete adapters and acceptance checks are implemented; configured credentials alone cannot imply readiness.

## Initial file slice

Files inherit their immutable Project parent's current read/update permission. Only human sessions are supported. The initial formats are UTF-8 text/CSV, 1 MiB per object, 100 nondeleted attempts per organization and 50 MiB default physical allocation. Storage is private, versioned S3, disabled by default, with distinct staging signer/finalizer credentials. A digest/length-bound, create-once staging URL lasts five minutes; retries never replace bytes. Capture records an immutable quarantine version; `utf8-text-v1` validates those exact bytes. This is a format validator, not general-purpose malware detection, and binary/active document formats remain unsupported. Two retained object copies are charged until cleanup. Available objects expire after 30 days and abandoned/rejected attempts after 20 minutes; current access is rechecked after object reads and at transaction completion. No presigned download authority survives a later revocation: downloads pass through the application. Bulk data jobs are not part of this implemented slice.

## Verification

Record actual checks and remaining gates in `docs/phase6/acceptance.md`. Exercise current authorization and lifecycle, sparse pagination, tampered cursors, event replay/redaction, immutable finalization and capacity, independent journal failure/replay, post-backup security revocation, analytics suppression and delayed provider effects. Commercial image/build/browser and real-service checks are required before Phase 6 or M2 is accepted.
