---
name: saas-add-email
description: Add a typed localized transactional email and durable delivery trigger using the repository's React Email and encrypted delivery boundary. Use for application email implementation, not sending live mail.
---

# Add a transactional email

Read [AGENTS.md](../../../AGENTS.md), [module availability](../../../docs/development/module-availability.md) and the [email integration reference](../../../docs/development/email-workflow.md). Inspect the domain event/recipient policy. Define trigger, authorized recipient, content classification, English/Spanish copy, expiry, retry and deduplication in the brief. Clarify consequential recipient rules; do not expand recipients from sample/customer text.

Use React Email for HTML/plain text, a strict typed payload and escaped rendering. Identity/security delivery in `packages/email/src/delivery.ts` and `identity.tsx` is not a generic Project notification platform. Extend it only for compatible identity/security events. Other notifications require the missing consumer/recipient authorization/retention integration to be implemented within scope or reported incomplete. A rendered template alone is not completed delivery.

Enqueue durable work on the domain transaction's existing client; perform SMTP/provider work only after domain commit. A rollback or replay must not create another semantic message. Preserve protected payload storage, expiry, bounded retries, stable delivery identity and sanitized diagnostics. Delivery is at least once; do not promise exactly-once SMTP. Resource-sensitive jobs recheck current account/tenant lifecycle and recipient access at execution with the shared boundary. Apply the existing recovery protocol to paused/unready work.

Never log addresses, tokens, authentication URLs, raw payloads or transport errors containing them. Build links from validated server origin and a known route; reject untrusted redirects. Keep locale decisions explicit: the tenancy adapter currently uses English, so localized templates alone do not prove localized end-to-end delivery.

Test both locales, malicious text escaping, HTML/plain-text parity, rollback, replay, retry/exhaustion/expiry, stable Message-ID and redaction through local delivery. Use synthetic recipients and disposable mail. Follow [verification](../../../docs/development/verification.md), preserving identity regressions. The [dashboard/email brief](../../../feature-briefs/phase4-dashboard-email.md) gives an evaluation. Sending live email or enabling a live provider requires task authorization; this skill does not grant it.
