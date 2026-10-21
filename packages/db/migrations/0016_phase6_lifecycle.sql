CREATE TABLE "foundation"."deletion_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"status_hash" text NOT NULL,
	"state" text DEFAULT 'awaiting_prerequisites' NOT NULL,
	"organizations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retained" jsonb DEFAULT '["restricted-security-audit","financial-records","backup-expiry"]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"journal_sequence" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "deletion_operation" UNIQUE("requester_id","operation_key"),
	CONSTRAINT "deletion_subject_kind" CHECK (subject_kind IN ('account','organization')),
	CONSTRAINT "deletion_state" CHECK (state IN ('awaiting_prerequisites','journal_pending','scheduled','purging','complete','canceled'))
);
--> statement-breakpoint
ALTER TABLE "foundation"."deletion_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "deletion_subject" ON "foundation"."deletion_requests" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE POLICY "migration_control" ON "foundation"."deletion_requests" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "lifecycle_control" ON "foundation"."deletion_requests" AS PERMISSIVE FOR ALL TO "saas_cook_lifecycle", "saas_cook_recovery" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE foundation.deletion_requests FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA foundation,tenancy,identity TO saas_cook_lifecycle,saas_cook_recovery;
GRANT SELECT,INSERT,UPDATE ON foundation.deletion_requests TO saas_cook_lifecycle,saas_cook_recovery;
GRANT SELECT ON foundation.installation TO saas_cook_lifecycle,saas_cook_recovery;
GRANT SELECT ON tenancy.organizations,tenancy.memberships,tenancy.seat_capacities,tenancy.ownership_transfers,tenancy.invitations,tenancy.authorization_revisions,tenancy.resource_registry,tenancy.resource_grants,tenancy.team_members,tenancy.teams,tenancy.service_accounts,tenancy.api_keys,tenancy.projects,tenancy.files,tenancy.billing_accounts,tenancy.membership_transitions,foundation.plan_versions,foundation.billing_prices,tenancy.billing_commands TO saas_cook_lifecycle,saas_cook_recovery;
GRANT INSERT ON tenancy.memberships,tenancy.membership_transitions,tenancy.audit_events,tenancy.outbox_events TO saas_cook_lifecycle,saas_cook_recovery;
GRANT UPDATE(status,ownership_version) ON tenancy.organizations TO saas_cook_lifecycle,saas_cook_recovery;
GRANT UPDATE(role,status,billable,seat_counted,expires_at) ON tenancy.memberships TO saas_cook_lifecycle,saas_cook_recovery;
GRANT UPDATE(occupied) ON tenancy.seat_capacities TO saas_cook_lifecycle,saas_cook_recovery;
GRANT UPDATE(status) ON tenancy.ownership_transfers,tenancy.invitations TO saas_cook_lifecycle,saas_cook_recovery;
GRANT UPDATE(revoked_at) ON tenancy.api_keys TO saas_cook_lifecycle,saas_cook_recovery;
GRANT UPDATE(status,version) ON tenancy.service_accounts TO saas_cook_lifecycle,saas_cook_recovery;
GRANT UPDATE(owner_membership_id) ON tenancy.projects TO saas_cook_lifecycle,saas_cook_recovery;
GRANT UPDATE(desired_revision,applied_revision,updated_at) ON tenancy.authorization_revisions TO saas_cook_lifecycle,saas_cook_recovery;
GRANT DELETE ON tenancy.resource_grants,tenancy.team_members TO saas_cook_lifecycle,saas_cook_recovery;
GRANT EXECUTE ON FUNCTION identity.lookup_user(text) TO saas_cook_lifecycle,saas_cook_recovery;
--> statement-breakpoint
CREATE FUNCTION foundation.account_organizations(p_user text) RETURNS TABLE(organization_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $$
 SELECT organization_id FROM tenancy.memberships WHERE user_id=p_user ORDER BY organization_id LIMIT 1001
$$;
REVOKE ALL ON FUNCTION foundation.account_organizations(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.account_organizations(text) TO saas_cook_lifecycle,saas_cook_recovery;
--> statement-breakpoint
CREATE FUNCTION foundation.lifecycle_identity(p_request uuid,p_purge boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,foundation,identity AS $$
DECLARE r foundation.deletion_requests; old_email text;
BEGIN
 SELECT * INTO STRICT r FROM foundation.deletion_requests WHERE id=p_request AND subject_kind='account' FOR UPDATE;
 IF p_purge AND (r.journal_sequence IS NULL OR r.state<>'purging') THEN RAISE EXCEPTION 'Journal required before purge'; END IF;
 IF NOT p_purge AND r.state NOT IN ('awaiting_prerequisites','journal_pending') THEN RAISE EXCEPTION 'Invalid freeze'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('user:'||r.subject_id,0));
 SELECT email INTO old_email FROM identity."user" WHERE id=r.subject_id;
 UPDATE identity."user" SET lifecycle_status=CASE WHEN p_purge THEN 'deleted' ELSE 'frozen' END,
 credential_epoch=credential_epoch+1,two_factor_enabled=false,
 name=CASE WHEN p_purge THEN '[deleted]' ELSE name END,
 email=CASE WHEN p_purge THEN r.id::text||'@deleted.invalid' ELSE email END,
 image=CASE WHEN p_purge THEN NULL ELSE image END,
 email_verified=CASE WHEN p_purge THEN false ELSE email_verified END,
 theme_mode=CASE WHEN p_purge THEN NULL ELSE theme_mode END WHERE id=r.subject_id;
 DELETE FROM identity.session WHERE user_id=r.subject_id;
 DELETE FROM identity.account WHERE user_id=r.subject_id;
 DELETE FROM identity.passkey WHERE user_id=r.subject_id;
 DELETE FROM identity.two_factor WHERE user_id=r.subject_id;
 DELETE FROM identity.verification WHERE strpos(value,r.subject_id)>0 OR strpos(identifier,r.subject_id)>0 OR strpos(value,old_email)>0 OR strpos(identifier,old_email)>0;
 IF p_purge THEN DELETE FROM identity.user_avatar WHERE user_id=r.subject_id; END IF;
 INSERT INTO identity.security_audit(id,user_id,action) VALUES(gen_random_uuid(),r.subject_id,CASE WHEN p_purge THEN 'account.deleted' ELSE 'account.frozen' END);
END $$;
REVOKE ALL ON FUNCTION foundation.lifecycle_identity(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.lifecycle_identity(uuid,boolean) TO saas_cook_lifecycle,saas_cook_recovery;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.project_activity_event(uuid,uuid) TO saas_cook_lifecycle,saas_cook_recovery;
--> statement-breakpoint
GRANT SELECT ON tenancy.audit_events TO saas_cook_lifecycle,saas_cook_recovery;
GRANT SELECT,INSERT ON tenancy.activity_events TO saas_cook_lifecycle,saas_cook_recovery;
