-- A local binding is necessary but never sufficient for independent readiness.
CREATE TABLE foundation.installation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 installation_id uuid NOT NULL UNIQUE, binding_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON foundation.installation TO common_saas_web,common_saas_worker,common_saas_identity;
GRANT USAGE ON SCHEMA foundation TO common_saas_identity;
--> statement-breakpoint
CREATE TABLE tenancy.authorization_revisions (
 organization_id uuid PRIMARY KEY REFERENCES tenancy.organizations(id),
 desired_revision bigint NOT NULL DEFAULT 1 CHECK (desired_revision > 0),
 applied_revision bigint NOT NULL DEFAULT 1 CHECK (applied_revision > 0),
 evaluation_mode text NOT NULL DEFAULT 'contextual-v1' CHECK (evaluation_mode='contextual-v1'),
 store_id text NOT NULL, model_id text NOT NULL, model_hash text NOT NULL,
 recovery_epoch uuid NOT NULL, ready boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenancy.authorization_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.authorization_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenancy.authorization_revisions
 USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid)
 WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY migration_control ON tenancy.authorization_revisions TO common_saas_migrator USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON tenancy.authorization_revisions TO common_saas_web,common_saas_worker;
