CREATE SCHEMA IF NOT EXISTS operator_identity;
CREATE SCHEMA IF NOT EXISTS backoffice;
CREATE TABLE "operator_identity"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backoffice"."audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_id" uuid,
	"case_reference" text,
	"outcome" text NOT NULL,
	"epoch" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backoffice"."grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"epoch" uuid NOT NULL,
	"environment" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backoffice"."grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "backoffice"."invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"digest" text NOT NULL,
	"epoch" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "invitations_digest_unique" UNIQUE("digest")
);
--> statement-breakpoint
CREATE TABLE "backoffice"."management_receipts" (
	"nonce" uuid PRIMARY KEY NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_identity"."passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text,
	CONSTRAINT "passkey_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "backoffice"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_identity"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"epoch" uuid NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "operator_identity"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT true NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"epoch" uuid NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "operator_status" CHECK ("operator_identity"."user"."status" IN ('invited','active','disabled'))
);
--> statement-breakpoint
CREATE TABLE "operator_identity"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_identity"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "operator_identity"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backoffice"."grants" ADD CONSTRAINT "grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "operator_identity"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backoffice"."invitations" ADD CONSTRAINT "invitations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "operator_identity"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_identity"."passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "operator_identity"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_identity"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "operator_identity"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_audit_time" ON "backoffice"."audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "operator_grant_lookup" ON "backoffice"."grants" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "operator_verification_identifier" ON "operator_identity"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE POLICY "operator_management" ON "backoffice"."grants" AS PERMISSIVE FOR ALL TO "saas_cook_bo_manager", "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "operator_scope" ON "backoffice"."grants" AS PERMISSIVE FOR SELECT TO "saas_cook_bo_query" USING ("backoffice"."grants"."organization_id"::text = current_setting('backoffice.organization_id', true) AND "backoffice"."grants"."user_id" = current_setting('backoffice.operator_id', true) AND "backoffice"."grants"."epoch"::text = current_setting('backoffice.epoch', true) AND "backoffice"."grants"."environment" = current_setting('backoffice.environment', true));
ALTER TABLE backoffice.grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA operator_identity, backoffice FROM PUBLIC;
GRANT USAGE ON SCHEMA operator_identity, backoffice TO saas_cook_bo_identity, saas_cook_bo_manager;
GRANT USAGE ON SCHEMA backoffice TO saas_cook_bo_query;
GRANT SELECT ON operator_identity."user" TO saas_cook_bo_identity;
GRANT UPDATE(status) ON operator_identity."user" TO saas_cook_bo_identity;
GRANT SELECT,INSERT,UPDATE,DELETE ON operator_identity.session,operator_identity.verification,operator_identity.passkey TO saas_cook_bo_identity;
GRANT SELECT ON operator_identity.account TO saas_cook_bo_identity;
GRANT SELECT ON backoffice.invitations TO saas_cook_bo_identity;
GRANT UPDATE(consumed_at) ON backoffice.invitations TO saas_cook_bo_identity;
GRANT SELECT,INSERT,UPDATE ON backoffice.rate_limits TO saas_cook_bo_identity;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA operator_identity TO saas_cook_bo_manager;
GRANT SELECT,INSERT,UPDATE,DELETE ON backoffice.invitations,backoffice.grants TO saas_cook_bo_manager;
GRANT SELECT,INSERT ON backoffice.management_receipts TO saas_cook_bo_manager;
GRANT SELECT ON backoffice.grants TO saas_cook_bo_query;
GRANT INSERT ON backoffice.audit_events TO saas_cook_bo_identity,saas_cook_bo_query,saas_cook_bo_manager;
GRANT USAGE ON SCHEMA foundation TO saas_cook_bo_query,saas_cook_bo_identity,saas_cook_bo_manager;
GRANT SELECT ON foundation.installation TO saas_cook_bo_query,saas_cook_bo_identity,saas_cook_bo_manager;
--> statement-breakpoint
-- Fixed metadata capability; no customer table grants or arbitrary SQL parameters.
CREATE FUNCTION backoffice.organization_metadata(target uuid)
RETURNS TABLE(id uuid,name text,lifecycle text,occupied integer,capacity integer,source_timestamp timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('organization:'||target::text,0));
 RETURN QUERY SELECT o.id,o.name,o.status,s.occupied,s.capacity,clock_timestamp()
 FROM tenancy.organizations o JOIN tenancy.seat_capacities s ON s.organization_id=o.id WHERE o.id=target;
END $$;
REVOKE ALL ON FUNCTION backoffice.organization_metadata(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backoffice.organization_metadata(uuid) TO saas_cook_bo_query;
--> statement-breakpoint
-- Deferred guard runs after all protected SQL and before the commit is accepted.
CREATE FUNCTION backoffice.guard_read_expiry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.action='organization.read' AND NEW.outcome='allowed' AND
 (nullif(current_setting('backoffice.expires_at',true),'') IS NULL OR
 current_setting('backoffice.expires_at')::timestamptz <= clock_timestamp()) THEN
 RAISE EXCEPTION 'Operator authorization expired';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER backoffice_read_expiry AFTER INSERT ON backoffice.audit_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION backoffice.guard_read_expiry();
--> statement-breakpoint
-- BO v1 only supports this reviewed additive schema pair. Future schemas require explicit compatibility review.
CREATE FUNCTION backoffice.assert_compatibility() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 26 THEN
 RAISE EXCEPTION 'Unsupported Backoffice schema pair';
 END IF;
END $$;
REVOKE ALL ON FUNCTION backoffice.assert_compatibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backoffice.assert_compatibility() TO saas_cook_bo_identity,saas_cook_bo_query,saas_cook_bo_manager;
