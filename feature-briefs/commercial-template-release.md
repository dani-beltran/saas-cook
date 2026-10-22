# Commercial template release sequencing

Decision date: 2026-10-22. Status: planning approved; Phase 8 implementation and release acceptance remain pending. The [delivery roadmap](../docs/06-delivery-roadmap.md#commercial-release-sequence--2026-10-22) remains the acceptance register.

## Product decision

Proceed directly from accepted Phase 6/M2 Commercial core to Phase 8 hardening and a tagged Commercial template release. Keep phase numbers and historical evidence references stable. Defer Phase 7 as an optional Enterprise extension and leave optional Backoffice deferred.

## Release scope

Harden implemented Commercial capabilities through performance and tenant-fairness checks, sustained built-image execution, failure and expanded recovery scenarios, accessibility, supported previous-release compatibility, bootstrap/rename presets, applicable skill evaluations and production image/security verification. Retain evidence against the declared source, preset/modules, image and upgrade baseline. Resolve missing evidence and unsupported upgrade claims before release sign-off.

Phase 7 SSO/SCIM, custom roles, enterprise security policies, guests, contract overrides, advanced operator governance, optional delegated support and advanced retention/legal-hold administration remain deferred. Existing Commercial authorization, seat admission, retention/hold safeguards and deletion/recovery requirements continue to apply. The revised Phase 6 asynchronous-provider acceptance criteria remain in force; this decision does not claim provider erasure completion.

## Later Enterprise acceptance

M3 remains pending until Phase 7 is implemented and accepted and applicable Phase 8 hardening is demonstrated for that Enterprise implementation. A prior Commercial release does not accept later Enterprise changes. Any enabled Backoffice must pass its own applicable release gates.

## Verification of this decision

This change updates planning documents only. It does not start Phase 8 implementation, enable Enterprise modules, waive release checks or record any new application acceptance result.
