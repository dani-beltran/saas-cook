CREATE TABLE "tenancy"."audit_access" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "audit_access_organization_id_membership_id_pk" PRIMARY KEY("organization_id","membership_id")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."audit_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."integration_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'https-api' NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"scopes" jsonb NOT NULL,
	"state" text DEFAULT 'unverified' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"checked_at" timestamp with time zone,
	CONSTRAINT "integration_state" CHECK (state IN ('unverified','active','unhealthy','revoked')),
	CONSTRAINT "integration_provider" CHECK (provider='https-api')
);
--> statement-breakpoint
ALTER TABLE "tenancy"."integration_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foundation"."notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"email_suppressed" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_locale" CHECK (locale IN ('en','es'))
);
--> statement-breakpoint
CREATE TABLE "tenancy"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"email_state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_source" UNIQUE("organization_id","user_id","source_id"),
	CONSTRAINT "notification_kind" CHECK (kind IN ('bulk.completed')),
	CONSTRAINT "notification_email_state" CHECK (email_state IN ('pending','delivered','skipped','failed'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foundation"."rollout_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"enabled" boolean NOT NULL,
	"percent" integer NOT NULL,
	"organizations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"environment" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "rollout_percent" CHECK (percent BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "foundation"."rollout_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rollout_history_version" UNIQUE("key","version")
);
--> statement-breakpoint
CREATE TABLE "tenancy"."webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"event" text NOT NULL,
	"target_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status" integer,
	CONSTRAINT "webhook_delivery_once" UNIQUE("organization_id","endpoint_id","source_id"),
	CONSTRAINT "webhook_delivery_state" CHECK (state IN ('pending','delivered','failed','canceled'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."webhook_endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" jsonb NOT NULL,
	"secret" text,
	"previous_secret" text,
	"previous_until" timestamp with time zone,
	"state" text DEFAULT 'unverified' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "webhook_state" CHECK (state IN ('unverified','active','revoked'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."audit_access" ADD CONSTRAINT "audit_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."audit_access" ADD CONSTRAINT "audit_access_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "tenancy"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_endpoint_id_webhook_endpoints_organization_id_id_fk" FOREIGN KEY ("organization_id","endpoint_id") REFERENCES "tenancy"."webhook_endpoints"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_delivery_due" ON "tenancy"."webhook_deliveries" USING btree ("state","available_at");--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."audit_access" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."audit_access" AS PERMISSIVE FOR ALL TO public USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."integration_connections" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."integration_connections" AS PERMISSIVE FOR ALL TO public USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."notifications" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."notifications" AS PERMISSIVE FOR ALL TO public USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."webhook_deliveries" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."webhook_deliveries" AS PERMISSIVE FOR ALL TO public USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."webhook_endpoints" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."webhook_endpoints" AS PERMISSIVE FOR ALL TO public USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
ALTER TABLE tenancy.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.webhook_endpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.webhook_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.integration_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.audit_access FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON tenancy.notifications,tenancy.webhook_endpoints,tenancy.webhook_deliveries,tenancy.integration_connections,tenancy.audit_access TO saas_cook_web,saas_cook_worker,saas_cook_lifecycle,saas_cook_recovery;
GRANT SELECT,INSERT,UPDATE ON foundation.notification_preferences TO saas_cook_lifecycle;
GRANT SELECT,DELETE ON foundation.notification_preferences TO saas_cook_recovery;
GRANT USAGE ON SCHEMA foundation TO saas_cook_platform_operator;
GRANT SELECT ON foundation.rollout_flags TO saas_cook_web,saas_cook_worker,saas_cook_lifecycle,saas_cook_platform_operator;
GRANT INSERT,UPDATE ON foundation.rollout_flags TO saas_cook_platform_operator;
GRANT INSERT,SELECT ON foundation.rollout_history TO saas_cook_platform_operator;
--> statement-breakpoint
CREATE FUNCTION tenancy.platform_event_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,tenancy AS $$
BEGIN
 IF NEW.action='bulk.completed' AND NEW.actor_id !~ '^(system|service):' THEN
 INSERT INTO tenancy.notifications(id,organization_id,user_id,source_id,kind,reference_id,expires_at)
 VALUES(gen_random_uuid(),NEW.organization_id,regexp_replace(NEW.actor_id,'^user:',''),NEW.id,'bulk.completed',NEW.target_id::uuid,clock_timestamp()+interval '7 days') ON CONFLICT DO NOTHING;
 END IF;
 IF NEW.action IN ('project.created','project.updated','project.deleted','bulk.completed') THEN
 INSERT INTO tenancy.webhook_deliveries(id,organization_id,endpoint_id,source_id,event,target_id,occurred_at)
 SELECT gen_random_uuid(),NEW.organization_id,e.id,NEW.id,NEW.action,NEW.target_id::uuid,NEW.occurred_at FROM tenancy.webhook_endpoints e
 WHERE e.organization_id=NEW.organization_id AND e.state='active' AND e.events ? NEW.action ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tenancy.platform_event_delivery() FROM PUBLIC;
CREATE TRIGGER platform_event_delivery AFTER INSERT ON tenancy.audit_events FOR EACH ROW EXECUTE FUNCTION tenancy.platform_event_delivery();
--> statement-breakpoint
CREATE FUNCTION tenancy.platform_delivery_due() RETURNS TABLE(organization_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $$
 SELECT DISTINCT organization_id FROM (SELECT organization_id FROM tenancy.webhook_deliveries WHERE state='pending' AND available_at<=clock_timestamp() UNION SELECT organization_id FROM tenancy.notifications WHERE email_state='pending' AND available_at<=clock_timestamp())q LIMIT 10
$$;
REVOKE ALL ON FUNCTION tenancy.platform_delivery_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.platform_delivery_due() TO saas_cook_worker,saas_cook_lifecycle;
