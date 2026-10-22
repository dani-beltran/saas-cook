# Durable PostHog erasure verification

The user authorized asynchronous background verification and an explicit M2 criteria revision on 2026-10-22, on PR #12 without merging.

Use existing suppressed analytics subjects and JSON receipts as the durable queue. Retain original provider identities/request time, retry with bounded backoff, and record pending/error/verified observations across process restarts. Only a matching provider completion record plus fresh event absence may certify erasure. Preserve the independent uncertain-ingestion barrier and collection suppression. Report requests still pending after seven days through a durable overdue marker and aggregate operational log; deployment owns alert routing.

M2 accepts demonstrated durable asynchronous handoff, restart/retry/overdue behavior and application late-ingestion barriers together with live provider acknowledgement/status/query evidence. Provider-scheduled final erasure and the dependent live late-ingestion completion exercise become explicit operational follow-ups, not release blockers or presumed passes. The original synthetic deletion stays tracked until verified. All other M2 gates, including source/image-bound checks, remain in force. No production infrastructure or physical-erasure guarantee is inferred.
