CREATE TABLE "foundation"."analytics_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid,
	"event" text NOT NULL,
	"feature" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "foundation"."analytics_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "migration_control" ON "foundation"."analytics_sources" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "analytics_control" ON "foundation"."analytics_sources" AS PERMISSIVE FOR ALL TO "saas_cook_lifecycle", "saas_cook_recovery" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE foundation.analytics_sources FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON foundation.analytics_sources TO saas_cook_lifecycle,saas_cook_recovery;
GRANT DELETE ON foundation.notification_preferences TO saas_cook_lifecycle,saas_cook_recovery;
GRANT SELECT,UPDATE ON tenancy.capacity_buckets,tenancy.capacity_reservations TO saas_cook_lifecycle,saas_cook_recovery;
GRANT UPDATE ON tenancy.files TO saas_cook_lifecycle,saas_cook_recovery;
GRANT SELECT,DELETE ON tenancy.notifications TO saas_cook_lifecycle,saas_cook_recovery;
CREATE FUNCTION foundation.notification_recipient(p_id uuid) RETURNS TABLE(user_id text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $$ SELECT user_id FROM tenancy.notifications WHERE id=p_id $$;
REVOKE ALL ON FUNCTION foundation.notification_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.notification_recipient(uuid) TO saas_cook_lifecycle;
--> statement-breakpoint
CREATE FUNCTION foundation.analytics_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,foundation,tenancy AS $$
DECLARE u text; e text; f text;
BEGIN
 IF (SELECT count(*) FROM (SELECT 1 FROM foundation.analytics_sources LIMIT 10000) q)>=10000 THEN RETURN NEW; END IF;
 IF TG_TABLE_SCHEMA='identity' THEN
 INSERT INTO foundation.analytics_sources(id,user_id,event) VALUES(gen_random_uuid(),NEW.id,'account.signed_up'); RETURN NEW;
 END IF;
 u:=regexp_replace(NEW.actor_id,'^user:','');
 IF NOT EXISTS(SELECT 1 FROM identity."user" WHERE id=u AND lifecycle_status='active') THEN RETURN NEW; END IF;
 IF NEW.action='organization.created' THEN e:='organization.created';
 ELSIF NEW.action IN ('project.created','example-customers.create','file.available','bulk.completed') THEN
 e:='core_action.completed'; f:=CASE NEW.action WHEN 'project.created' THEN 'projects' WHEN 'example-customers.create' THEN 'customers' WHEN 'file.available' THEN 'files' ELSE CASE WHEN NEW.changes->>'kind'='projects.import' THEN 'imports' ELSE 'exports' END END;
 ELSE RETURN NEW; END IF;
 INSERT INTO foundation.analytics_sources(id,user_id,organization_id,event,feature,occurred_at) VALUES(NEW.id,u,NEW.organization_id,e,f,NEW.occurred_at) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundation.analytics_source() FROM PUBLIC;
CREATE TRIGGER analytics_signup AFTER INSERT ON identity."user" FOR EACH ROW EXECUTE FUNCTION foundation.analytics_source();
CREATE TRIGGER analytics_activity AFTER INSERT ON tenancy.audit_events FOR EACH ROW EXECUTE FUNCTION foundation.analytics_source();
--> statement-breakpoint
CREATE FUNCTION foundation.analytics_paid_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,foundation,tenancy AS $$
DECLARE u text; e text; was_paid boolean; is_paid boolean;
BEGIN
 was_paid:=false;
 IF TG_OP='UPDATE' THEN was_paid:=OLD.status='paid' AND OLD.amount_paid>0; END IF;
 is_paid:=NEW.status='paid' AND NEW.amount_paid>0;
 IF was_paid=is_paid OR EXISTS(SELECT 1 FROM tenancy.billing_invoices i WHERE i.organization_id=NEW.organization_id AND i.id<>NEW.id AND i.status='paid' AND i.amount_paid>0) THEN RETURN NEW; END IF;
 IF (SELECT count(*) FROM (SELECT 1 FROM foundation.analytics_sources LIMIT 10000) q)>=10000 THEN RETURN NEW; END IF;
 SELECT m.user_id INTO u FROM tenancy.memberships m JOIN identity."user" x ON x.id=m.user_id WHERE m.organization_id=NEW.organization_id AND m.role='owner' AND m.status='active' AND x.lifecycle_status='active' ORDER BY m.id LIMIT 1;
 IF u IS NULL THEN RETURN NEW; END IF;
 e:=CASE WHEN is_paid THEN 'subscription.paid_started' ELSE 'subscription.paid_retracted' END;
 INSERT INTO foundation.analytics_sources(id,user_id,organization_id,event) VALUES(gen_random_uuid(),u,NEW.organization_id,e);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION foundation.analytics_paid_source() FROM PUBLIC;
CREATE TRIGGER analytics_paid AFTER INSERT OR UPDATE ON tenancy.billing_invoices FOR EACH ROW EXECUTE FUNCTION foundation.analytics_paid_source();
--> statement-breakpoint
-- Purge authority is limited to an independently journaled request. Retained financial and security records remain restricted.
CREATE FUNCTION foundation.lifecycle_local(p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,foundation,identity,tenancy AS $$
DECLARE r foundation.deletion_requests; o uuid;
BEGIN
 SELECT * INTO STRICT r FROM foundation.deletion_requests WHERE id=p_request AND state='purging' AND journal_sequence IS NOT NULL;
 IF r.subject_kind='account' THEN
 PERFORM foundation.lifecycle_identity(p_request,true);
 DELETE FROM foundation.notification_preferences WHERE user_id=r.subject_id;
 DELETE FROM foundation.analytics_sources WHERE user_id=r.subject_id;
 DELETE FROM foundation.analytics_preferences WHERE subject_kind='account' AND subject_id=r.subject_id;
 DELETE FROM tenancy.notifications WHERE user_id=r.subject_id;
 UPDATE tenancy.invitations SET email='deleted@deleted.invalid',token_hash=encode(sha256(convert_to(id::text,'UTF8')),'hex'),status=CASE WHEN status='pending' THEN 'canceled' ELSE status END WHERE accepted_by=r.subject_id;
 ELSE
 o:=r.subject_id::uuid;
 IF NOT EXISTS(SELECT 1 FROM tenancy.organizations WHERE id=o AND status='suspended') THEN RAISE EXCEPTION 'Organization must be frozen'; END IF;
 DELETE FROM tenancy.activity_events WHERE organization_id=o;
 DELETE FROM tenancy.notifications WHERE organization_id=o;
 DELETE FROM tenancy.webhook_deliveries WHERE organization_id=o;
 DELETE FROM tenancy.webhook_endpoints WHERE organization_id=o;
 DELETE FROM tenancy.integration_connections WHERE organization_id=o;
 DELETE FROM tenancy.settings_operations WHERE organization_id=o;
 DELETE FROM tenancy.audit_access WHERE organization_id=o;
 DELETE FROM tenancy.bulk_rows WHERE organization_id=o;
 DELETE FROM tenancy.bulk_jobs WHERE organization_id=o;
 DELETE FROM tenancy.files WHERE organization_id=o;
 DELETE FROM tenancy.resource_grants WHERE organization_id=o;
 DELETE FROM tenancy.resource_operations WHERE organization_id=o;
 DELETE FROM tenancy.example_customer_operations WHERE organization_id=o;
 DELETE FROM tenancy.example_customers WHERE organization_id=o;
 DELETE FROM tenancy.projects WHERE organization_id=o;
 DELETE FROM tenancy.resource_registry WHERE organization_id=o;
 DELETE FROM tenancy.team_members WHERE organization_id=o;
 DELETE FROM tenancy.teams WHERE organization_id=o;
 DELETE FROM tenancy.api_keys WHERE organization_id=o;
 DELETE FROM tenancy.service_accounts WHERE organization_id=o;
 DELETE FROM tenancy.invitations WHERE organization_id=o;
 DELETE FROM tenancy.ownership_transfers WHERE organization_id=o;
 UPDATE tenancy.organizations SET name='[deleted]',slug='deleted-'||id::text WHERE id=o;
 DELETE FROM foundation.analytics_sources WHERE organization_id=o;
 DELETE FROM foundation.analytics_preferences WHERE subject_kind='organization' AND subject_id=r.subject_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION foundation.lifecycle_local(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.lifecycle_local(uuid) TO saas_cook_lifecycle,saas_cook_recovery;
--> statement-breakpoint
-- Pending identity messages cannot disclose a deleted user's recipient or authentication URLs.

CREATE FUNCTION identity.email_recipient_active(p_email text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,identity AS $$ SELECT NOT EXISTS(SELECT 1 FROM identity."user" WHERE email=lower(p_email) AND lifecycle_status<>'active') $$;
REVOKE ALL ON FUNCTION identity.email_recipient_active(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.email_recipient_active(text) TO saas_cook_worker;
CREATE FUNCTION foundation.purge_identity_messages(p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,foundation,identity AS $$
DECLARE r foundation.deletion_requests; mail text;
BEGIN
 SELECT * INTO STRICT r FROM foundation.deletion_requests WHERE id=p_request AND subject_kind='account' AND state='purging' AND journal_sequence IS NOT NULL;
 SELECT email INTO mail FROM identity."user" WHERE id=r.subject_id;
 DELETE FROM identity.email_delivery WHERE recipient_hash=encode(sha256(convert_to(lower(mail),'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION foundation.purge_identity_messages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.purge_identity_messages(uuid) TO saas_cook_lifecycle,saas_cook_recovery;
--> statement-breakpoint
CREATE FUNCTION foundation.recovery_platform() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,foundation,tenancy AS $$
BEGIN
 UPDATE tenancy.webhook_endpoints SET state='revoked',secret=NULL,previous_secret=NULL,version=version+1;
 UPDATE tenancy.integration_connections SET state='revoked',secret=NULL,version=version+1;
 UPDATE tenancy.webhook_deliveries SET state='canceled' WHERE state='pending';
 UPDATE tenancy.bulk_jobs SET state='canceled',expires_at=clock_timestamp() WHERE state<>'expired';
 DELETE FROM tenancy.audit_access;
 UPDATE tenancy.notifications SET email_state='skipped' WHERE email_state='pending';
 UPDATE foundation.analytics_events SET state='dropped' WHERE state='pending';
 DELETE FROM foundation.analytics_sources;
END $$;
REVOKE ALL ON FUNCTION foundation.recovery_platform() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.recovery_platform() TO saas_cook_recovery;
--> statement-breakpoint
CREATE FUNCTION foundation.analytics_report_rows(p_start timestamptz,p_end timestamptz) RETURNS TABLE(id uuid,subject text,organization text,event text,feature text,occurred_at timestamptz,synthetic boolean) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,foundation AS $$
 SELECT e.id,e.subject_id,encode(sha256(convert_to(s.organization_id::text,'UTF8')),'hex'),e.event,e.feature,e.occurred_at,e.synthetic FROM foundation.analytics_events e JOIN foundation.analytics_subjects s ON s.id=e.subject_id WHERE p_end>p_start AND p_end-p_start<=interval '90 days' AND e.occurred_at>=p_start AND e.occurred_at<p_end AND NOT s.suppressed AND e.state='delivered' ORDER BY e.occurred_at,e.id LIMIT 100001
$$;
REVOKE ALL ON FUNCTION foundation.analytics_report_rows(timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.analytics_report_rows(timestamptz,timestamptz) TO saas_cook_platform_operator;

--> statement-breakpoint
GRANT UPDATE(state) ON tenancy.billing_commands TO saas_cook_lifecycle,saas_cook_recovery;
GRANT SELECT ON tenancy.example_customers TO saas_cook_worker;
