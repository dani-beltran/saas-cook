# Exercise principal and tenant boundaries

Support service principals explicitly for Task endpoints. Keys use current project:read/project:update scopes and current parent grants; no implicit human authority. Test overlapping memberships, viewer/editor/admin/revoked users, wrong tenant, expired/revoked keys, undeclared identity/sharing endpoints and unknown fields. Both transports must enforce the same service policy. Do not alter existing principal boundaries.
