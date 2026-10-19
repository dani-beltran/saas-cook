CREATE TABLE "tenancy"."files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"requester_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"reservation_id" uuid NOT NULL,
	"state" text DEFAULT 'staging' NOT NULL,
	"object" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "file_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "file_operation" UNIQUE("organization_id","requester_id","operation_key"),
	CONSTRAINT "file_state" CHECK (state IN ('staging','available','rejected','deleted')),
	CONSTRAINT "file_bytes" CHECK (bytes BETWEEN 1 AND 1048576),
	CONSTRAINT "file_content_type" CHECK (content_type IN ('text/plain','text/csv')),
	CONSTRAINT "file_available_identity" CHECK (state<>'available' OR object IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."files" ADD CONSTRAINT "files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."files" ADD CONSTRAINT "files_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "tenancy"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_expiry" ON "tenancy"."files" USING btree ("expires_at","organization_id");--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."files" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."files" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE tenancy.files FORCE ROW LEVEL SECURITY;
GRANT SELECT ON tenancy.files TO saas_cook_web,saas_cook_worker;
GRANT INSERT ON tenancy.files TO saas_cook_web;
GRANT UPDATE(state,object,reservation_id,expires_at) ON tenancy.files TO saas_cook_web;
GRANT UPDATE(state,object,name) ON tenancy.files TO saas_cook_worker;
--> statement-breakpoint
CREATE FUNCTION tenancy.file_cleanup_due() RETURNS TABLE(organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $$
 SELECT DISTINCT organization_id FROM (SELECT organization_id FROM tenancy.files WHERE expires_at<=now() AND state<>'deleted' ORDER BY expires_at LIMIT 100) due LIMIT 5
$$;
REVOKE ALL ON FUNCTION tenancy.file_cleanup_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.file_cleanup_due() TO saas_cook_worker;
