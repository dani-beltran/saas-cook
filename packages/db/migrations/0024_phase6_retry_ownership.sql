ALTER TABLE "foundation"."deletion_requests" ADD COLUMN "resolutions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenancy"."bulk_jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenancy"."bulk_jobs" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION tenancy.bulk_due() RETURNS TABLE(organization_id uuid,id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $$
 SELECT organization_id,id FROM (SELECT organization_id,id,row_number() OVER (PARTITION BY organization_id ORDER BY available_at,id) AS position FROM tenancy.bulk_jobs WHERE (state IN ('pending','running') AND available_at<=clock_timestamp()) OR (expires_at<clock_timestamp() AND state<>'expired')) j WHERE position=1 LIMIT 10
$$;
--> statement-breakpoint
CREATE FUNCTION foundation.personal_export(p_user text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,foundation,identity AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'emailVerified',u.email_verified,'theme',u.theme_mode,'notifications',(SELECT jsonb_build_object('email',p.email,'inApp',p.in_app,'locale',p.locale,'suppressed',p.email_suppressed) FROM foundation.notification_preferences p WHERE p.user_id=u.id),'analytics',(SELECT enabled FROM foundation.analytics_preferences WHERE subject_kind='account' AND subject_id=u.id)) FROM identity."user" u WHERE u.id=p_user AND u.lifecycle_status='active'
$$;
REVOKE ALL ON FUNCTION foundation.personal_export(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.personal_export(text) TO saas_cook_lifecycle;
--> statement-breakpoint
CREATE FUNCTION identity.background_assurance(p_session text,p_user text,p_epoch text) RETURNS TABLE(method text,authenticated_at timestamptz,mfa boolean,recovery_epoch text,credential_epoch bigint,expires_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,identity AS $$
 SELECT s.authentication_method,s.authenticated_at,s.mfa,s.recovery_epoch,s.credential_epoch,s.expires_at FROM identity.session s JOIN identity."user" u ON u.id=s.user_id WHERE s.id=p_session AND s.user_id=p_user AND s.recovery_epoch=p_epoch AND s.credential_epoch=u.credential_epoch AND s.expires_at>clock_timestamp() AND u.lifecycle_status='active' AND u.email_verified AND (NOT u.two_factor_enabled OR s.mfa)
$$;
REVOKE ALL ON FUNCTION identity.background_assurance(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.background_assurance(text,text,text) TO saas_cook_worker;

--> statement-breakpoint
-- Bulk imports use the same tenant-fenced quota admission as interactive Project creation.
GRANT INSERT ON tenancy.quota_buckets,tenancy.quota_reservations TO saas_cook_worker;
