-- Isolated synthetic spike schema, never a production application migration.
CREATE SCHEMA IF NOT EXISTS phase0_authz;
CREATE TABLE IF NOT EXISTS phase0_authz.tenants (
  organization text PRIMARY KEY, desired bigint NOT NULL DEFAULT 1, applied bigint NOT NULL DEFAULT 0,
  generation text NOT NULL DEFAULT '', model text NOT NULL, epoch text NOT NULL, ready boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS phase0_authz.memberships (
  organization text NOT NULL REFERENCES phase0_authz.tenants, actor text NOT NULL,
  active boolean NOT NULL DEFAULT true, expires_at timestamptz, PRIMARY KEY (organization, actor)
);
CREATE TABLE IF NOT EXISTS phase0_authz.source_tuples (
  id bigserial PRIMARY KEY, organization text NOT NULL REFERENCES phase0_authz.tenants, tuple jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS source_tuples_org ON phase0_authz.source_tuples (organization, id);
CREATE INDEX IF NOT EXISTS source_tuples_object ON phase0_authz.source_tuples (organization, (tuple->>'object'));
CREATE TABLE IF NOT EXISTS phase0_authz.resources (
  organization text NOT NULL REFERENCES phase0_authz.tenants, object text NOT NULL, version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization, object)
);
CREATE TABLE IF NOT EXISTS phase0_authz.attempts (
  id uuid PRIMARY KEY, organization text NOT NULL REFERENCES phase0_authz.tenants, generation text NOT NULL UNIQUE,
  revision bigint NOT NULL, model text NOT NULL, epoch text NOT NULL,
  state text NOT NULL CHECK (state IN ('building','verified','active','retired','abandoned')),
  tuples jsonb NOT NULL, manifest text NOT NULL, lease_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz, activated_at timestamptz, cleaned_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_generation ON phase0_authz.attempts (organization) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS attempts_cleanup ON phase0_authz.attempts (state, cleaned_at);
CREATE TABLE IF NOT EXISTS phase0_authz.outbox (
  organization text NOT NULL REFERENCES phase0_authz.tenants, revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz, PRIMARY KEY (organization, revision)
);
