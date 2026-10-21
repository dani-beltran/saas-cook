CREATE TABLE "tenancy"."settings_operations" (
	"organization_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "settings_operations_organization_id_actor_id_operation_key_pk" PRIMARY KEY("organization_id","actor_id","operation_key")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."settings_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."settings_operations" ADD CONSTRAINT "settings_operations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."settings_operations" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."settings_operations" AS PERMISSIVE FOR ALL TO public USING (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
ALTER TABLE tenancy.settings_operations FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON tenancy.settings_operations TO saas_cook_web,saas_cook_worker,saas_cook_lifecycle,saas_cook_recovery;
