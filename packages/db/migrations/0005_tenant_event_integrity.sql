-- Additive hardening: an outbox event may only reference its own tenant's audit record.
ALTER TABLE tenancy.audit_events ADD CONSTRAINT audit_events_organization_id_id_key UNIQUE (organization_id,id);
ALTER TABLE tenancy.outbox_events DROP CONSTRAINT outbox_events_id_fkey;
ALTER TABLE tenancy.outbox_events ADD CONSTRAINT outbox_events_organization_id_id_fkey
 FOREIGN KEY (organization_id,id) REFERENCES tenancy.audit_events(organization_id,id);
-- Existing records predate correlation capture; retain NULL rather than invent historical request IDs.
ALTER TABLE tenancy.audit_events ADD COLUMN request_id uuid,
 ADD COLUMN trace_id text CHECK (trace_id IS NULL OR trace_id ~ '^[0-9a-f]{32}$');
