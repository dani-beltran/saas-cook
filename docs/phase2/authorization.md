# Phase 2 authorization and privileged recovery

Production authorization lives in `packages/authz`. It does not import Phase 0 fixture code. Its immutable model covers active organization members, owner/admin/member/billing roles and non-nested teams. This document describes the immutable Phase 2 predecessor. The active successor adds direct Project grants and service accounts; arbitrary custom roles remain unsupported. See the [current resource protocol](../phase3/README.md).

Every positive tenant decision reaches OpenFGA with `HIGHER_CONSISTENCY`, the independently pinned store/model, and a fresh namespace containing organization, recovery epoch and a cryptographically random request ID. The compiler emits at most four contextual tuples for one organization or team. IDs containing graph syntax are rejected. There are no production tuple writes, reusable authorization capabilities, cached decisions or permission publication queues. Requests do not reuse preflight results: mutations evaluate their current inputs while holding the exclusive fence.

The tenancy service acquires sorted user lifecycle fences before the shared/exclusive organization fence and keeps its live transaction connection through identity/membership checks, independent readiness, OpenFGA, domain SQL, audit/outbox and commit. Authorization changes advance desired and applied source revisions together. Expiry uses PostgreSQL time and is checked again after the HTTP response. A lost application connection prevents a late allowed response from committing. OpenFGA failures, missing responses, unsupported policy inputs and readiness/epoch/model mismatches deny access.

## Independent initialization

`infra/compose.yaml` runs the synthetic control database on a separate PostgreSQL instance at port 55434. Production must give that protected store an independent backup/recovery lifecycle; it must never be replaced with an application snapshot. Runtime `CONTROL_DATABASE_URL` uses `saas_cook_control_reader`, which has only SELECT on installation publication state. One-off commands use the distinct `CONTROL_ADMIN_DATABASE_URL`. The independent store retains initialization receipts, epochs, immutable model identity and operator approvals. The application stores only its installation binding and tenant source-publication state.

Apply reviewed application migrations before `bootstrap`. Bootstrap requires `MIGRATION_DATABASE_URL`, `CONTROL_ADMIN_DATABASE_URL`, `INSTALLATION_ID` and `OPENFGA_API_URL`. It validates dedicated database roles, refuses pre-existing identities/organizations/bindings as a fresh installation, records independent pending state and the local binding, creates the immutable OpenFGA store/model, validates the real evaluator, then releases independent readiness. Retrying interrupted initialization reuses the recorded binding/epoch/model. A completed installation with independent readiness, the current model hash and a matching application binding/epoch returns success with “Bootstrap already completed successfully; nothing to do.” This checks recorded completion, not live OpenFGA health; use `authz-publish` to validate the evaluator and source publication. It does not change the epoch, model, readiness or completion audit event. A completed or restored installation cannot be reinitialized as fresh; recovery-required state and binding/epoch/model mismatches still fail. An ambiguous remote create can leave an unused model/store; it cannot release readiness or grant application access.

`authz-publish` verifies the already pinned model and contextual source publication. It never clears recovery state, copies a current epoch onto restored credentials, or treats revision equality as recovery approval. Restored data whose independent epoch/binding differs remains denied. Before restoring an application database, the operator must close independent readiness and rotate its epoch according to the canonical recovery protocol in `docs/04-billing-usage-operations.md`. Phase 2 does not claim the Phase 6 deletion-journal replay or full application-restore release workflow.

## Sole-owner security deactivation and recovery

The packaged `security-deactivate` and `owner-recovery` modes accept `--approval /path/to/approval.json`. These are one-off control-plane commands, never public tenant endpoints. They use the restricted application web role, the dedicated control administrator, the installed public verification key, the normal encrypted email outbox and the production contextual authorization service. The private signing key belongs to the independent authority; it is never a runtime application setting or part of the image.

The independent authority must verify organizational authority, operator MFA and the exact target before issuing approval. Recovery also requires independently attested recent replacement-user authentication and MFA. Approval is an Ed25519-signed envelope:

```json
{"payload":"base64url-of-UTF8-claims-JSON","signature":"base64url-of-Ed25519-signature-over-payload-bytes"}
```

The claim object has exactly these fields, with UUID installation/epoch/nonce/organization IDs:

```json
{
  "version": 1,
  "installationId": "<configured installation UUID>",
  "epoch": "<current independently retained epoch UUID>",
  "nonce": "<fresh UUID>",
  "operatorId": "verified-operator-id",
  "organizationId": "<organization UUID>",
  "subjectUserId": "<replacement user ID>",
  "scope": "owner:recover",
  "evidenceReference": "authority-case:verified-evidence-reference",
  "mfaAt": "2026-09-26T12:00:00.000Z",
  "expiresAt": "2026-09-26T12:04:00.000Z",
  "subjectAuthenticatedAt": "2026-09-26T12:00:00.000Z",
  "subjectMethod": "passkey",
  "subjectMfa": true
}
```

For deactivation, use scope `security:deactivate`, set `subjectUserId` and `membershipId` to the exact target, and omit the three `subject*` assurance fields except `subjectUserId`. Set `OWNER_RECOVERY_PUBLIC_KEY` to the independent authority's Ed25519 SPKI PEM. Invalid signatures, unknown fields, another installation/epoch/scope, future timestamps, expired approvals and MFA older than five minutes are rejected. Approval expiry must be within five minutes of operator MFA. The command has no unsigned bypass flag.

The command records verified claims, nonce and payload hash independently before mutation. It serializes use of the nonce; the same nonce with different claims is rejected. After source commit it records completion independently. If the final control acknowledgement is lost, a retry reconciles the exact local signed-command audit receipt (nonce, payload hash, operator, scope and subject) and does not repeat admission, grant access again or send duplicate mail.

Security deactivation works while OpenFGA is unavailable, deactivates even the final owner, releases its seat and enters `owner_recovery_required`. Recovery admits the verified replacement through the same locked seat transition, advances the source revision, and obtains an actual current OpenFGA ownership decision before its transaction can reopen the organization. FGA failure rolls back recovery and leaves the organization closed. A previously deactivated owner is not silently restored. Recovery emits a tenant audit event and encrypted transactional recovery email.

## Verification

The authorization suite uses real restricted PostgreSQL roles, a separate control instance and real OpenFGA. It exercises model/bootstrap retry and existing-data rejection; organization/team roles and tenant isolation; revocation/fence ordering; old-namespace late writes; late allowed responses after application connection loss; actual HTTP timeout/outage and recovery within 30 seconds; server-time expiry during HTTP latency; independent epoch and model mismatch; and signed security deactivation/recovery with outage, seat/mail idempotency and independent evidence.

Run `bun run test:unit` and `bun run test:integration` after starting disposable services. Phase 2 image and browser acceptance are tracked separately in the delivery record; the historical Phase 0 benchmark is not a production performance claim.
