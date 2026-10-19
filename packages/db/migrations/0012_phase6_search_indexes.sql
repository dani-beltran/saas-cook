CREATE INDEX "projects_search_name" ON "tenancy"."projects" USING gin (to_tsvector('simple',name)) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "example_customers_search_name" ON "tenancy"."example_customers" USING gin (to_tsvector('simple',name)) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- Expose only tenants requiring bounded activity retention work to the worker.
CREATE FUNCTION tenancy.activity_retention_due() RETURNS TABLE(organization_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $function$
 SELECT DISTINCT organization_id FROM (SELECT organization_id FROM tenancy.activity_events WHERE occurred_at<=clock_timestamp()-interval '90 days' ORDER BY occurred_at LIMIT 1000) due LIMIT 10;
$function$;
REVOKE ALL ON FUNCTION tenancy.activity_retention_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.activity_retention_due() TO saas_cook_worker;
