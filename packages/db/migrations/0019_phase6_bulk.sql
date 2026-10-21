CREATE TABLE "tenancy"."bulk_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"requester_id" text NOT NULL,
	"session_id" text NOT NULL,
	"epoch" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft" text,
	"object" jsonb,
	"reservation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bulk_operation" UNIQUE("organization_id","requester_id","operation_key"),
	CONSTRAINT "bulk_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "bulk_kind" CHECK (kind IN ('projects.import','projects.export','organization.export','audit.export')),
	CONSTRAINT "bulk_state" CHECK (state IN ('pending','running','complete','failed','canceled','expired')),
	CONSTRAINT "bulk_bound" CHECK (progress BETWEEN 0 AND 1000 AND total BETWEEN 0 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."bulk_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."bulk_rows" (
	"organization_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"state" text NOT NULL,
	"resource_id" uuid,
	CONSTRAINT "bulk_row_once" UNIQUE("organization_id","job_id","row"),
	CONSTRAINT "bulk_row_state" CHECK (state IN ('created','skipped','failed'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."bulk_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."bulk_jobs" ADD CONSTRAINT "bulk_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."bulk_rows" ADD CONSTRAINT "bulk_rows_organization_id_job_id_bulk_jobs_organization_id_id_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "tenancy"."bulk_jobs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_due" ON "tenancy"."bulk_jobs" USING btree ("state","created_at");--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."bulk_jobs" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."bulk_jobs" AS PERMISSIVE FOR ALL TO public USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."bulk_rows" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."bulk_rows" AS PERMISSIVE FOR ALL TO public USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
ALTER TABLE tenancy.bulk_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.bulk_rows FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON tenancy.bulk_jobs,tenancy.bulk_rows TO saas_cook_web,saas_cook_worker,saas_cook_lifecycle,saas_cook_recovery;
CREATE FUNCTION tenancy.bulk_due() RETURNS TABLE(organization_id uuid,id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $$
 SELECT organization_id,id FROM (SELECT organization_id,id,row_number() OVER (PARTITION BY organization_id ORDER BY created_at,id) AS position FROM tenancy.bulk_jobs WHERE state IN ('pending','running') OR (expires_at<clock_timestamp() AND state<>'expired')) j WHERE position=1 LIMIT 10
$$;
REVOKE ALL ON FUNCTION tenancy.bulk_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.bulk_due() TO saas_cook_worker;
