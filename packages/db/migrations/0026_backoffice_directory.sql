CREATE INDEX "operator_directory_scope" ON "backoffice"."grants" USING btree ("user_id","epoch","environment","organization_id","id");--> statement-breakpoint
ALTER POLICY "operator_scope" ON "backoffice"."grants" TO saas_cook_bo_query USING (("backoffice"."grants"."organization_id"::text = current_setting('backoffice.organization_id', true) OR current_setting('backoffice.directory', true) = 'on') AND "backoffice"."grants"."user_id" = current_setting('backoffice.operator_id', true) AND "backoffice"."grants"."epoch"::text = current_setting('backoffice.epoch', true) AND "backoffice"."grants"."environment" = current_setting('backoffice.environment', true));--> statement-breakpoint
-- Every allowed directory page, including an empty one, retains the final expiry guard.
CREATE OR REPLACE FUNCTION backoffice.guard_read_expiry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.action IN ('organization.read','organization.directory') AND NEW.outcome='allowed' AND
 (nullif(current_setting('backoffice.expires_at',true),'') IS NULL OR
 current_setting('backoffice.expires_at')::timestamptz <= clock_timestamp()) THEN
 RAISE EXCEPTION 'Operator authorization expired';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Additive pair: old lookup binaries remain supported; directory binaries require this function.
CREATE OR REPLACE FUNCTION backoffice.assert_compatibility() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 27 THEN
 RAISE EXCEPTION 'Unsupported Backoffice schema pair';
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION backoffice.assert_directory_compatibility() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM backoffice.assert_compatibility();
END $$;
REVOKE ALL ON FUNCTION backoffice.assert_directory_compatibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backoffice.assert_directory_compatibility() TO saas_cook_bo_query;
