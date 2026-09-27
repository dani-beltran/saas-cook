CREATE SCHEMA tenancy;
--> statement-breakpoint
REVOKE ALL ON SCHEMA tenancy FROM PUBLIC;
GRANT USAGE ON SCHEMA tenancy TO saas_cook_web, saas_cook_worker;
CREATE TABLE tenancy.organizations (
 id uuid PRIMARY KEY, slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','owner_recovery_required','suspended')),
 ownership_version integer NOT NULL DEFAULT 1, require_mfa boolean NOT NULL DEFAULT false, accept_passkey_mfa boolean NOT NULL DEFAULT false,
 required_auth_method text CHECK (required_auth_method IN ('passkey','sso')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenancy.memberships (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES tenancy.organizations(id),
 user_id text NOT NULL REFERENCES identity."user"(id),
 role text NOT NULL CHECK (role IN ('owner','admin','member','billing')),
 status text NOT NULL CHECK (status IN ('active','inactive')), billable boolean NOT NULL CHECK (billable = (role <> 'billing')),
 expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,id), UNIQUE (organization_id,user_id)
);
CREATE INDEX memberships_user_status ON tenancy.memberships(user_id,status);
CREATE FUNCTION tenancy.immutable_membership_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.user_id<>OLD.user_id THEN
  RAISE EXCEPTION 'Membership identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tenancy.immutable_membership_identity() FROM PUBLIC;
CREATE TRIGGER immutable_membership_identity BEFORE UPDATE ON tenancy.memberships
FOR EACH ROW EXECUTE FUNCTION tenancy.immutable_membership_identity();
CREATE TABLE tenancy.seat_capacities (
 organization_id uuid PRIMARY KEY REFERENCES tenancy.organizations(id),
 capacity integer NOT NULL CHECK (capacity >= 0), occupied integer NOT NULL DEFAULT 0 CHECK (occupied >= 0),
 policy_version integer NOT NULL DEFAULT 1, reconciliation_required boolean NOT NULL DEFAULT false
);
CREATE TABLE tenancy.membership_transitions (
 organization_id uuid NOT NULL REFERENCES tenancy.organizations(id), operation_key text NOT NULL,
 input_hash text NOT NULL, membership_id uuid NOT NULL, delta integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id,operation_key),
 FOREIGN KEY (organization_id,membership_id) REFERENCES tenancy.memberships(organization_id,id)
);
CREATE TABLE tenancy.invitations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES tenancy.organizations(id),
 email text NOT NULL CHECK (email = lower(email)), operation_key text NOT NULL, UNIQUE (organization_id,operation_key), token_hash text NOT NULL UNIQUE,
 role text NOT NULL CHECK (role IN ('admin','member','billing')),
 inviter_membership_id uuid NOT NULL, expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','canceled')),
 accepted_by text REFERENCES identity."user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,id),
 FOREIGN KEY (organization_id,inviter_membership_id) REFERENCES tenancy.memberships(organization_id,id)
);
CREATE TABLE tenancy.teams (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES tenancy.organizations(id),
 slug text NOT NULL, name text NOT NULL, UNIQUE (organization_id,id), UNIQUE (organization_id,slug)
);
CREATE TABLE tenancy.team_members (
 organization_id uuid NOT NULL, team_id uuid NOT NULL, membership_id uuid NOT NULL,
 PRIMARY KEY (organization_id,team_id,membership_id),
 FOREIGN KEY (organization_id,team_id) REFERENCES tenancy.teams(organization_id,id),
 FOREIGN KEY (organization_id,membership_id) REFERENCES tenancy.memberships(organization_id,id)
);
CREATE TABLE tenancy.ownership_transfers (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES tenancy.organizations(id),
 initiator_membership_id uuid NOT NULL, recipient_membership_id uuid NOT NULL,
 ownership_version integer NOT NULL, outgoing_role text NOT NULL CHECK (outgoing_role IN ('admin','member','billing','inactive')),
 expires_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','canceled','expired')),
 accepted_at timestamptz, UNIQUE (organization_id,id),
 CHECK (initiator_membership_id <> recipient_membership_id),
 FOREIGN KEY (organization_id,initiator_membership_id) REFERENCES tenancy.memberships(organization_id,id),
 FOREIGN KEY (organization_id,recipient_membership_id) REFERENCES tenancy.memberships(organization_id,id)
);
CREATE UNIQUE INDEX transfers_one_pending ON tenancy.ownership_transfers(organization_id,initiator_membership_id) WHERE status='pending';
CREATE TABLE tenancy.audit_events (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES tenancy.organizations(id),
 actor_id text NOT NULL, action text NOT NULL, target_id text NOT NULL, changes jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_timeline ON tenancy.audit_events(organization_id,occurred_at DESC,id DESC);
CREATE TABLE tenancy.outbox_events (
 id uuid PRIMARY KEY REFERENCES tenancy.audit_events(id), organization_id uuid NOT NULL REFERENCES tenancy.organizations(id),
 type text NOT NULL, schema_version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenancy.owner_recovery_cases (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES tenancy.organizations(id), operator_id text NOT NULL,
 evidence_reference text NOT NULL, replacement_user_id text NOT NULL REFERENCES identity."user"(id),
 outcome text NOT NULL CHECK (outcome='completed'), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Organization routing also requires tenant context; cross-tenant navigation uses only the fixed lookup below.
ALTER TABLE tenancy.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenancy.organizations
 USING (id=nullif(current_setting('app.organization_id',true),'')::uuid)
 WITH CHECK (id=nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY migration_control ON tenancy.organizations TO saas_cook_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON tenancy.organizations TO saas_cook_web, saas_cook_worker;
DO $$
DECLARE target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['memberships','seat_capacities','membership_transitions','invitations','teams','team_members','ownership_transfers','audit_events','outbox_events','owner_recovery_cases'] LOOP
  EXECUTE format('ALTER TABLE tenancy.%I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE tenancy.%I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('CREATE POLICY tenant_isolation ON tenancy.%I USING (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid)',target);
  -- Only dedicated migration-owned, fixed-query control-plane functions use this policy.
  EXECUTE format('CREATE POLICY migration_control ON tenancy.%I TO saas_cook_migrator USING (true) WITH CHECK (true)',target);
 END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenancy.memberships, tenancy.seat_capacities, tenancy.invitations, tenancy.ownership_transfers TO saas_cook_web,saas_cook_worker;
GRANT SELECT, INSERT ON tenancy.membership_transitions, tenancy.audit_events, tenancy.outbox_events, tenancy.owner_recovery_cases TO saas_cook_web,saas_cook_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenancy.teams, tenancy.team_members TO saas_cook_web,saas_cook_worker;
--> statement-breakpoint
CREATE FUNCTION tenancy.organizations_for_user(subject text)
RETURNS TABLE(id uuid,slug text,name text,status text,role text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT o.id,o.slug,o.name,o.status,m.role FROM tenancy.organizations o
 JOIN tenancy.memberships m ON m.organization_id=o.id
 WHERE m.user_id=subject AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp())
 ORDER BY o.name,o.id
$$;
REVOKE ALL ON FUNCTION tenancy.organizations_for_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.organizations_for_user(text) TO saas_cook_web,saas_cook_worker;
