-- Reviewed tenant-isolation experiment; application migrations begin in Phase 1.
CREATE SCHEMA IF NOT EXISTS phase0_rls;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='phase0_runtime') THEN
    CREATE ROLE phase0_runtime LOGIN PASSWORD 'phase0-runtime'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS phase0_rls.memberships (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active','inactive')),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_status
  ON phase0_rls.memberships (user_id, status);
CREATE TABLE IF NOT EXISTS phase0_rls.projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_membership_id uuid NOT NULL,
  name text NOT NULL,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, owner_membership_id)
    REFERENCES phase0_rls.memberships (organization_id, id)
);
CREATE TABLE IF NOT EXISTS phase0_rls.tasks (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES phase0_rls.projects (organization_id, id)
);
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['memberships','projects','tasks'] LOOP
    EXECUTE format('ALTER TABLE phase0_rls.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE phase0_rls.%I FORCE ROW LEVEL SECURITY', tab);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON phase0_rls.%I', tab);
    EXECUTE format('CREATE POLICY tenant_scope ON phase0_rls.%I USING
      (organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')::uuid)', tab);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA phase0_rls TO phase0_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA phase0_rls TO phase0_runtime;
