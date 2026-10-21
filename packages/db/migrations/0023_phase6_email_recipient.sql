ALTER TABLE "identity"."email_delivery" ADD COLUMN "recipient_hash" text;--> statement-breakpoint
ALTER FUNCTION foundation.security_fingerprint() RENAME TO security_fingerprint_core;
CREATE FUNCTION foundation.security_fingerprint() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,foundation,tenancy AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('core',foundation.security_fingerprint_core(),
 'integrations',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM tenancy.integration_connections i),
 'webhooks',(SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM tenancy.webhook_endpoints w),
 'audit_access',(SELECT jsonb_agg(to_jsonb(a) ORDER BY organization_id,membership_id) FROM tenancy.audit_access a),
 'analytics',(SELECT jsonb_agg(to_jsonb(p) ORDER BY subject_kind,subject_id) FROM foundation.analytics_preferences p),
 'notifications',(SELECT jsonb_agg(to_jsonb(p) ORDER BY user_id) FROM foundation.notification_preferences p)
 )::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION foundation.security_fingerprint(),foundation.security_fingerprint_core() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION foundation.security_fingerprint_core() FROM saas_cook_recovery;
GRANT EXECUTE ON FUNCTION foundation.security_fingerprint() TO saas_cook_recovery;

--> statement-breakpoint
-- Predecessor encrypted messages have no recipient index. Expire them on upgrade;
-- users can request a fresh message, and no unindexed old recipient survives purge.
UPDATE identity.email_delivery SET failed_at=coalesce(failed_at,clock_timestamp()),encrypted_payload='' WHERE recipient_hash IS NULL;
CREATE OR REPLACE FUNCTION identity.email_recipient_active(p_email text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,identity AS $$
DECLARE u text;
BEGIN
 SELECT id INTO u FROM identity."user" WHERE email=lower(p_email);
 IF u IS NULL THEN RETURN true; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('user:'||u,0));
 RETURN EXISTS(SELECT 1 FROM identity."user" WHERE id=u AND email=lower(p_email) AND lifecycle_status='active');
END $$;
