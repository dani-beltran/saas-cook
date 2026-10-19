CREATE TABLE "tenancy"."billing_accounts" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"customer_id" text,
	"subscription_id" text,
	"plan_version_id" text,
	"provider_status" text DEFAULT 'none' NOT NULL,
	"access_state" text DEFAULT 'free' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp (3) with time zone,
	"period_end" timestamp (3) with time zone,
	"trial_end" timestamp (3) with time zone,
	"cancel_at" timestamp (3) with time zone,
	"grace_end" timestamp (3) with time zone,
	"valid_until" timestamp (3) with time zone,
	"source_version" integer DEFAULT 1 NOT NULL,
	"fingerprint" text DEFAULT '' NOT NULL,
	"health" text DEFAULT 'pending' NOT NULL,
	"reconciled_at" timestamp (3) with time zone,
	"next_reconcile_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled" jsonb,
	"locale" text DEFAULT 'en' NOT NULL,
	CONSTRAINT "billing_customer_mapping" UNIQUE("environment","customer_id"),
	CONSTRAINT "billing_subscription_mapping" UNIQUE("environment","subscription_id"),
	CONSTRAINT "billing_quantity" CHECK (quantity BETWEEN 0 AND 100000),
	CONSTRAINT "billing_health" CHECK (health IN ('pending','healthy','outage','review')),
	CONSTRAINT "billing_access" CHECK (access_state IN ('free','trial','pending','active','grace','restricted','canceled')),
	CONSTRAINT "billing_locale" CHECK (locale IN ('en','es'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."billing_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."billing_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"authorization" jsonb NOT NULL,
	"authorized_until" timestamp (3) with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_attempt_at" timestamp (3) with time zone,
	"available_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_command_operation" UNIQUE("organization_id","actor_id","operation_key"),
	CONSTRAINT "billing_command_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "billing_command_kind" CHECK (kind IN ('checkout','change','cancel','portal')),
	CONSTRAINT "billing_command_state" CHECK (state IN ('pending','submitted','complete','failed','review'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."billing_commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."billing_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"notice_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "billing_delivery_recipient" UNIQUE("organization_id","notice_id","user_id"),
	CONSTRAINT "billing_delivery_state" CHECK (state IN ('pending','delivered','failed','expired','revoked'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."billing_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foundation"."billing_inbox" (
	"environment" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"customer_id" text,
	"api_version" text,
	"digest" text NOT NULL,
	"state" text NOT NULL,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp (3) with time zone,
	"reason" text,
	CONSTRAINT "billing_inbox_environment_event_id_pk" PRIMARY KEY("environment","event_id"),
	CONSTRAINT "billing_inbox_state" CHECK (state IN ('pending','processed','quarantined','ignored'))
);
--> statement-breakpoint
CREATE TABLE "tenancy"."billing_invoices" (
	"organization_id" uuid NOT NULL,
	"id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_due" integer NOT NULL,
	"amount_paid" integer NOT NULL,
	"status" text NOT NULL,
	"hosted_url" text,
	"period_start" timestamp (3) with time zone NOT NULL,
	"period_end" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "billing_invoices_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."billing_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."billing_notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"notice_key" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "billing_notice_key" UNIQUE("organization_id","notice_key"),
	CONSTRAINT "billing_notice_org_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."billing_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."billing_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"source_version" integer NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"effective_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"proration_date" integer NOT NULL,
	CONSTRAINT "billing_preview_org_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."billing_previews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foundation"."billing_prices" (
	"environment" text NOT NULL,
	"price_id" text NOT NULL,
	"plan_version_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount" integer NOT NULL,
	"interval" text NOT NULL,
	CONSTRAINT "billing_prices_environment_price_id_pk" PRIMARY KEY("environment","price_id"),
	CONSTRAINT "billing_price_plan" UNIQUE("environment","plan_version_id"),
	CONSTRAINT "billing_price_values" CHECK (amount >= 0 AND currency ~ '^[a-z]{3}$' AND interval IN ('month','year'))
);
--> statement-breakpoint
CREATE TABLE "tenancy"."billing_reconciliations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_version" integer NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenancy"."billing_reconciliations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foundation"."plan_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_key" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_version_key" UNIQUE("plan_key","version"),
	CONSTRAINT "plan_version_positive" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "tenancy"."quota_buckets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"metric_version" integer DEFAULT 1 NOT NULL,
	"period_start" timestamp (3) with time zone NOT NULL,
	"period_end" timestamp (3) with time zone NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"watermark" bigint DEFAULT 0 NOT NULL,
	"aggregate_version" integer DEFAULT 1 NOT NULL,
	"policy_kind" text NOT NULL,
	"capacity" integer,
	CONSTRAINT "quota_window" UNIQUE("organization_id","metric","metric_version","period_start"),
	CONSTRAINT "quota_bucket_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "quota_values" CHECK (consumed>=0 AND reserved>=0 AND period_end>period_start AND (capacity IS NULL OR capacity>=0) AND policy_kind IN ('missing','disabled','limited','unlimited'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."quota_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."quota_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"bucket_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"operation_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "quota_operation" UNIQUE("organization_id","metric","operation_key"),
	CONSTRAINT "quota_reservation_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "quota_reservation_values" CHECK (quantity>0 AND state IN ('reserved','committed','released','expired'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."quota_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."usage_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"organization_id" uuid NOT NULL,
	"bucket_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"metric_version" integer DEFAULT 1 NOT NULL,
	"operation_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"correction_of" uuid,
	"reason" text,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "usage_event_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "usage_event_operation" UNIQUE("organization_id","metric","operation_key"),
	CONSTRAINT "usage_event_quantity" CHECK (quantity<>0 AND (quantity>0 OR correction_of IS NOT NULL) AND dimensions='{}'::jsonb AND metric='projects.created' AND metric_version=1)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."usage_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD COLUMN "seat_counted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenancy"."billing_accounts" ADD CONSTRAINT "billing_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."billing_accounts" ADD CONSTRAINT "billing_accounts_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "foundation"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."billing_commands" ADD CONSTRAINT "billing_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."billing_deliveries" ADD CONSTRAINT "billing_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."billing_deliveries" ADD CONSTRAINT "billing_deliveries_organization_id_notice_id_billing_notices_organization_id_id_fk" FOREIGN KEY ("organization_id","notice_id") REFERENCES "tenancy"."billing_notices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."billing_notices" ADD CONSTRAINT "billing_notices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."billing_previews" ADD CONSTRAINT "billing_previews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundation"."billing_prices" ADD CONSTRAINT "billing_prices_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "foundation"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."billing_reconciliations" ADD CONSTRAINT "billing_reconciliations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."quota_buckets" ADD CONSTRAINT "quota_buckets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."quota_reservations" ADD CONSTRAINT "quota_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."quota_reservations" ADD CONSTRAINT "quota_reservations_organization_id_bucket_id_quota_buckets_organization_id_id_fk" FOREIGN KEY ("organization_id","bucket_id") REFERENCES "tenancy"."quota_buckets"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."usage_events" ADD CONSTRAINT "usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."usage_events" ADD CONSTRAINT "usage_events_organization_id_bucket_id_quota_buckets_organization_id_id_fk" FOREIGN KEY ("organization_id","bucket_id") REFERENCES "tenancy"."quota_buckets"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."usage_events" ADD CONSTRAINT "usage_events_organization_id_correction_of_usage_events_organization_id_id_fk" FOREIGN KEY ("organization_id","correction_of") REFERENCES "tenancy"."usage_events"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_commands_pending" ON "tenancy"."billing_commands" USING btree ("organization_id","available_at");--> statement-breakpoint
CREATE INDEX "billing_inbox_pending" ON "foundation"."billing_inbox" USING btree ("state","received_at");--> statement-breakpoint
CREATE INDEX "billing_reconciliations_org" ON "tenancy"."billing_reconciliations" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "quota_expiry" ON "tenancy"."quota_reservations" USING btree ("organization_id","bucket_id","state","expires_at");--> statement-breakpoint
CREATE INDEX "usage_rebuild" ON "tenancy"."usage_events" USING btree ("organization_id","bucket_id","sequence");--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."billing_accounts" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."billing_accounts" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."billing_commands" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."billing_commands" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."billing_deliveries" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."billing_deliveries" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."billing_invoices" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."billing_invoices" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."billing_notices" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."billing_notices" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."billing_previews" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."billing_previews" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."billing_reconciliations" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."billing_reconciliations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."quota_buckets" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."quota_buckets" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."quota_reservations" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."quota_reservations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."usage_events" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."usage_events" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
-- Preserve the existing counted occupancy on upgrade. Eligibility reconciliation runs under lifecycle fences.
UPDATE tenancy.memberships SET seat_counted=(status='active' AND billable);
-- Runtime tenants are nonowners. Global catalogues are installed only by a reviewed command.
GRANT SELECT ON foundation.plan_versions, foundation.billing_prices TO saas_cook_web, saas_cook_worker;
GRANT SELECT,INSERT ON foundation.billing_inbox TO saas_cook_web;
GRANT SELECT,UPDATE ON foundation.billing_inbox TO saas_cook_worker;
CREATE FUNCTION foundation.immutable_billing_catalogue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append a new plan version or mapping; sold catalogue history is immutable'; END $$;
CREATE TRIGGER immutable_plan BEFORE UPDATE OR DELETE ON foundation.plan_versions FOR EACH ROW EXECUTE FUNCTION foundation.immutable_billing_catalogue();
CREATE TRIGGER immutable_price BEFORE UPDATE OR DELETE ON foundation.billing_prices FOR EACH ROW EXECUTE FUNCTION foundation.immutable_billing_catalogue();
REVOKE ALL ON FUNCTION foundation.immutable_billing_catalogue() FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE tenancy.billing_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.billing_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.billing_previews FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.billing_invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.billing_reconciliations FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.billing_notices FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.billing_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.quota_buckets FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.quota_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.usage_events FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON tenancy.billing_accounts,tenancy.billing_commands,tenancy.billing_previews,tenancy.billing_notices,tenancy.quota_buckets,tenancy.quota_reservations,tenancy.usage_events TO saas_cook_web;
GRANT SELECT ON tenancy.billing_invoices,tenancy.billing_reconciliations TO saas_cook_web;
GRANT UPDATE(locale) ON tenancy.billing_accounts TO saas_cook_web;
GRANT UPDATE(consumed,reserved,watermark,aggregate_version,policy_kind,capacity) ON tenancy.quota_buckets TO saas_cook_web,saas_cook_worker;
GRANT UPDATE(state) ON tenancy.quota_reservations TO saas_cook_web,saas_cook_worker;
GRANT USAGE ON SEQUENCE tenancy.usage_events_sequence_seq TO saas_cook_web,saas_cook_worker;
GRANT SELECT,INSERT ON tenancy.billing_invoices,tenancy.billing_reconciliations,tenancy.billing_notices,tenancy.billing_deliveries,tenancy.usage_events TO saas_cook_worker;
GRANT SELECT ON tenancy.billing_accounts,tenancy.billing_commands,tenancy.billing_previews,tenancy.quota_buckets,tenancy.quota_reservations TO saas_cook_worker;
GRANT UPDATE(customer_id,subscription_id,plan_version_id,provider_status,access_state,quantity,period_start,period_end,trial_end,cancel_at,grace_end,valid_until,source_version,fingerprint,health,reconciled_at,next_reconcile_at,features,scheduled) ON tenancy.billing_accounts TO saas_cook_worker;
GRANT UPDATE(state,attempts,first_attempt_at,available_at,result,error_code) ON tenancy.billing_commands TO saas_cook_worker;
GRANT UPDATE(currency,amount_due,amount_paid,status,hosted_url,period_start,period_end) ON tenancy.billing_invoices TO saas_cook_worker;
GRANT UPDATE(dispatched_at) ON tenancy.billing_notices TO saas_cook_worker;
GRANT UPDATE(state,attempts,available_at,encrypted_payload) ON tenancy.billing_deliveries TO saas_cook_worker;
--> statement-breakpoint
-- Minimal global discovery returns routing IDs, never tenant billing content.
CREATE FUNCTION foundation.billing_route(env text, customer text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $$
 SELECT organization_id FROM tenancy.billing_accounts WHERE environment=env AND customer_id=customer
$$;
CREATE FUNCTION foundation.billing_work(env text) RETURNS TABLE(organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tenancy,foundation AS $$
 SELECT a.organization_id FROM tenancy.billing_accounts a WHERE a.environment=env AND
 (a.next_reconcile_at<=now() OR EXISTS(SELECT 1 FROM tenancy.billing_commands c WHERE c.organization_id=a.organization_id AND c.state IN ('pending','submitted') AND c.available_at<=now()) OR EXISTS(SELECT 1 FROM foundation.billing_inbox i WHERE i.environment=a.environment AND i.customer_id=a.customer_id AND i.state='pending')) ORDER BY a.next_reconcile_at LIMIT 10
$$;
CREATE FUNCTION foundation.billing_notice_work() RETURNS TABLE(organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $$
 SELECT n.organization_id FROM tenancy.billing_notices n WHERE n.dispatched_at IS NULL OR EXISTS(SELECT 1 FROM tenancy.billing_deliveries d WHERE d.organization_id=n.organization_id AND d.notice_id=n.id AND d.state='pending' AND d.available_at<=now()) GROUP BY n.organization_id ORDER BY min(n.created_at) LIMIT 10
$$;
REVOKE ALL ON FUNCTION foundation.billing_route(text,text),foundation.billing_work(text),foundation.billing_notice_work() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.billing_route(text,text) TO saas_cook_web,saas_cook_worker;
GRANT EXECUTE ON FUNCTION foundation.billing_work(text),foundation.billing_notice_work() TO saas_cook_worker;
--> statement-breakpoint
-- Count newly inserted memberships consistently, including narrowly scoped fixture/control inserts.
-- Admission and organization/seat atomicity remain owned by the transition service.
CREATE FUNCTION tenancy.initialize_seat_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.seat_counted := NEW.status='active' AND NEW.billable; RETURN NEW; END $$;
CREATE TRIGGER initialize_seat_count BEFORE INSERT ON tenancy.memberships FOR EACH ROW EXECUTE FUNCTION tenancy.initialize_seat_count();
REVOKE ALL ON FUNCTION tenancy.initialize_seat_count() FROM PUBLIC;
