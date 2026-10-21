CREATE TABLE "tenancy"."activity_events" (
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "activity_events_organization_id_source_id_pk" PRIMARY KEY("organization_id","source_id"),
	CONSTRAINT "activity_type" CHECK (resource_type IN ('project','customer')),
	CONSTRAINT "activity_action" CHECK (action IN ('created','updated','deleted','restored')),
	CONSTRAINT "activity_actor" CHECK (actor IN ('member','service','system'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."activity_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."activity_events" ADD CONSTRAINT "activity_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."activity_events" ADD CONSTRAINT "activity_events_organization_id_source_id_audit_events_organization_id_id_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "tenancy"."audit_events"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_resource_order" ON "tenancy"."activity_events" USING btree ("organization_id","resource_type","resource_id","occurred_at","source_id");--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."activity_events" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."activity_events" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE tenancy.activity_events FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON tenancy.activity_events TO saas_cook_web,saas_cook_worker;
GRANT DELETE ON tenancy.activity_events TO saas_cook_worker;
--> statement-breakpoint
-- Fixed event/field catalogue. The source id is a composite tenant FK, and replay
-- never rehydrates arbitrary audit payloads or activity outside its retention window.
CREATE FUNCTION tenancy.project_activity_event(org uuid, source uuid) RETURNS void
LANGUAGE sql SET search_path = pg_catalog,tenancy AS $function$
 INSERT INTO tenancy.activity_events(organization_id,source_id,resource_type,resource_id,action,actor,occurred_at)
 SELECT organization_id,id,
  CASE WHEN action LIKE 'project.%' THEN 'project' ELSE 'customer' END,
  target_id::uuid,
  CASE action WHEN 'project.created' THEN 'created' WHEN 'project.updated' THEN 'updated'
   WHEN 'project.deleted' THEN 'deleted' WHEN 'project.restored' THEN 'restored'
   WHEN 'example-customers.create' THEN 'created' WHEN 'example-customers.update' THEN 'updated' ELSE 'deleted' END,
  CASE WHEN actor_id LIKE 'user:%' THEN 'member' WHEN actor_id LIKE 'service:%' THEN 'service' ELSE 'system' END,
  occurred_at
 FROM tenancy.audit_events
 WHERE organization_id=org AND id=source
  AND occurred_at > clock_timestamp()-interval '90 days'
  AND action IN ('project.created','project.updated','project.deleted','project.restored','example-customers.create','example-customers.update','example-customers.delete')
  AND target_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 ON CONFLICT DO NOTHING;
$function$;
REVOKE ALL ON FUNCTION tenancy.project_activity_event(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.project_activity_event(uuid,uuid) TO saas_cook_web,saas_cook_worker;
--> statement-breakpoint
CREATE FUNCTION tenancy.append_activity_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,tenancy AS $function$
 BEGIN PERFORM tenancy.project_activity_event(NEW.organization_id,NEW.id); RETURN NEW; END;
$function$;
REVOKE ALL ON FUNCTION tenancy.append_activity_projection() FROM PUBLIC;
CREATE TRIGGER activity_projection AFTER INSERT ON tenancy.audit_events
 FOR EACH ROW EXECUTE FUNCTION tenancy.append_activity_projection();
