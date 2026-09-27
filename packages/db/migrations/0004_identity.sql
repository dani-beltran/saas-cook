-- Better Auth owns credentials; domain lifecycle and immutable assurance are protected below.
ALTER TABLE identity."user" ADD COLUMN two_factor_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active','frozen','deleted')),
 ADD COLUMN credential_epoch bigint NOT NULL DEFAULT 1 CHECK (credential_epoch > 0);
ALTER TABLE identity.session ADD COLUMN authentication_method text NOT NULL DEFAULT 'unknown',
 ADD COLUMN authenticated_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN user_verified boolean NOT NULL DEFAULT false,
 ADD COLUMN mfa boolean NOT NULL DEFAULT false,
 ADD COLUMN credential_epoch bigint NOT NULL DEFAULT 1,
 ADD COLUMN recovery_epoch text NOT NULL DEFAULT 'uninitialized';
CREATE INDEX identity_verification_identifier ON identity.verification(identifier);
CREATE TABLE identity.passkey (
 id text PRIMARY KEY, name text, public_key text NOT NULL, user_id text NOT NULL REFERENCES identity."user"(id),
 credential_id text UNIQUE NOT NULL, counter integer NOT NULL, device_type text NOT NULL, backed_up boolean NOT NULL,
 transports text, created_at timestamptz, aaguid text
);
CREATE TABLE identity.two_factor (
 id text PRIMARY KEY, user_id text UNIQUE NOT NULL REFERENCES identity."user"(id), secret text NOT NULL,
 backup_codes text NOT NULL, verified boolean NOT NULL DEFAULT false,
 failed_verification_count integer NOT NULL DEFAULT 0, locked_until timestamptz
);
CREATE TABLE identity.rate_limit (id text PRIMARY KEY, key text UNIQUE NOT NULL, count integer NOT NULL, last_request bigint NOT NULL);
CREATE TABLE identity.ingress_limit (key text PRIMARY KEY, window_start timestamptz NOT NULL, count integer NOT NULL);
CREATE TABLE identity.security_audit (id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES identity."user"(id), action text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE identity.email_delivery (
 id uuid PRIMARY KEY, encrypted_payload text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), available_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0, delivered_at timestamptz, failed_at timestamptz
);
CREATE INDEX identity_email_pending ON identity.email_delivery(available_at) WHERE delivered_at IS NULL AND failed_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.passkey,identity.two_factor,identity.rate_limit,identity.ingress_limit,identity.security_audit TO saas_cook_identity;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.email_delivery TO saas_cook_identity;
GRANT USAGE ON SCHEMA identity TO saas_cook_web, saas_cook_worker;
GRANT INSERT ON identity.email_delivery TO saas_cook_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.email_delivery TO saas_cook_worker;
--> statement-breakpoint
CREATE FUNCTION identity.lookup_user(requested_id text)
 RETURNS TABLE(id text,email text,email_verified boolean,lifecycle_status text,credential_epoch bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT u.id,u.email,u.email_verified,u.lifecycle_status,u.credential_epoch FROM identity."user" u WHERE u.id=requested_id
$$;
REVOKE ALL ON FUNCTION identity.lookup_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.lookup_user(text) TO saas_cook_web, saas_cook_worker;
-- Lock and recheck inside the actual INSERT transaction, including independent provider pools.
CREATE FUNCTION identity.validate_session_creation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE current_identity identity."user"%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('user:'||NEW.user_id,0));
 SELECT * INTO current_identity FROM identity."user" WHERE id=NEW.user_id;
 IF current_identity.lifecycle_status IS DISTINCT FROM 'active' OR NOT current_identity.email_verified THEN
  RAISE EXCEPTION 'identity unavailable' USING ERRCODE='42501';
 END IF;
 NEW.credential_epoch := current_identity.credential_epoch;
 RETURN NEW;
END $$;
CREATE TRIGGER identity_session_lifecycle BEFORE INSERT ON identity.session FOR EACH ROW EXECUTE FUNCTION identity.validate_session_creation();
REVOKE ALL ON FUNCTION identity.validate_session_creation() FROM PUBLIC;
