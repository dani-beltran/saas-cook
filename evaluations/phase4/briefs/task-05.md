# Preserve field and pagination boundaries

Expose only declared Task DTO fields and reject hidden/server-owned input. Use bounded opaque actor/tenant/query-bound cursors and expected versions. Audit/outbox hold bounded IDs/version metadata, never Task text or credentials. Exercise malformed cursors, limits, unknown fields, scoped retries and stale versions.
