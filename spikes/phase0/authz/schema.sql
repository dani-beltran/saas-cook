-- Isolated synthetic spike schema, never a production application migration.
CREATE SCHEMA IF NOT EXISTS phase0_authz;
CREATE TABLE IF NOT EXISTS phase0_authz.tenants (
  organization text PRIMARY KEY, desired bigint NOT NULL DEFAULT 1, applied bigint NOT NULL DEFAULT 0,
  generation text NOT NULL DEFAULT '', model text NOT NULL, epoch text NOT NULL, ready boolean NOT NULL DEFAULT true
);
ALTER TABLE phase0_authz.tenants ADD COLUMN IF NOT EXISTS evaluation_mode text NOT NULL DEFAULT 'full-copy' CHECK (evaluation_mode IN ('full-copy','contextual'));
CREATE TABLE IF NOT EXISTS phase0_authz.memberships (
  organization text NOT NULL REFERENCES phase0_authz.tenants, actor text NOT NULL,
  active boolean NOT NULL DEFAULT true, expires_at timestamptz, PRIMARY KEY (organization, actor)
);
CREATE TABLE IF NOT EXISTS phase0_authz.source_tuples (
  id bigserial PRIMARY KEY, organization text NOT NULL REFERENCES phase0_authz.tenants, tuple jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS source_tuples_org ON phase0_authz.source_tuples (organization, id);
CREATE INDEX IF NOT EXISTS source_tuples_object ON phase0_authz.source_tuples (organization, (tuple->>'object'));
CREATE INDEX IF NOT EXISTS source_tuples_lookup ON phase0_authz.source_tuples (organization, (tuple->>'object'), (tuple->>'relation'), (tuple->>'user'));
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
-- Keep namespace tombstones, not full graph payloads, after terminal transitions.
-- Cleanup discovers late writes from OpenFGA, so it never needs these old arrays.
CREATE OR REPLACE FUNCTION phase0_authz.compact_terminal_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state IN ('retired','abandoned') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'Terminal authorization attempt cannot be reactivated';
  END IF;
  IF NEW.state IN ('retired','abandoned') THEN
    NEW.tuples := '[]'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER compact_terminal_snapshot
BEFORE INSERT OR UPDATE ON phase0_authz.attempts
FOR EACH ROW EXECUTE FUNCTION phase0_authz.compact_terminal_snapshot();
-- Upgrade an existing disposable fixture as well as newly created attempts.
UPDATE phase0_authz.attempts SET tuples = '[]'::jsonb
WHERE state IN ('retired','abandoned') AND tuples <> '[]'::jsonb;
CREATE TABLE IF NOT EXISTS phase0_authz.cleanup_cursors (
  endpoint text NOT NULL, store text NOT NULL, organization_prefix text NOT NULL,
  continuation_token text NOT NULL DEFAULT '', completed_sweeps bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (endpoint, store, organization_prefix)
);
CREATE TABLE IF NOT EXISTS phase0_authz.outbox (
  organization text NOT NULL REFERENCES phase0_authz.tenants, revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz, PRIMARY KEY (organization, revision)
);
