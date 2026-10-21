CREATE TABLE "foundation"."recovery_enrollments" (
	"epoch" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_enrollment" UNIQUE("epoch","user_id")
);
--> statement-breakpoint
CREATE TABLE "foundation"."recovery_state" (
	"epoch" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"stage" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_mode" CHECK (mode IN ('application','fga-only')),
	CONSTRAINT "recovery_stage" CHECK (stage IN ('reset','published'))
);
--> statement-breakpoint
ALTER TABLE "foundation"."recovery_enrollments" ADD CONSTRAINT "recovery_enrollments_epoch_recovery_state_epoch_fk" FOREIGN KEY ("epoch") REFERENCES "foundation"."recovery_state"("epoch") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON foundation.recovery_state,foundation.recovery_enrollments TO saas_cook_recovery;
CREATE FUNCTION foundation.recovery_organizations() RETURNS TABLE(id uuid,status text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,tenancy AS $$ SELECT id,status FROM tenancy.organizations ORDER BY id $$;
REVOKE ALL ON FUNCTION foundation.recovery_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.recovery_organizations() TO saas_cook_recovery;
--> statement-breakpoint
-- No raw security material leaves the dedicated function: only its digest is attested independently.
CREATE FUNCTION foundation.security_fingerprint() RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,foundation,tenancy,identity AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
 'binding',(SELECT to_jsonb(i) FROM foundation.installation i),
 'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM identity."user" u),
 'accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM identity.account a),
 'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM identity.session s),
 'passkeys',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM identity.passkey p),
 'factors',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM identity.two_factor f),
 'organizations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM tenancy.organizations o),
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM tenancy.memberships m),
 'teams',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tenancy.teams t),
 'team_members',(SELECT jsonb_agg(to_jsonb(t) ORDER BY organization_id,team_id,membership_id) FROM tenancy.team_members t),
 'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM tenancy.resource_grants g),
 'resources',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM tenancy.resource_registry r),
 'keys',(SELECT jsonb_agg(to_jsonb(k) ORDER BY id) FROM tenancy.api_keys k),
 'services',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM tenancy.service_accounts s)
 )::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION foundation.security_fingerprint() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.security_fingerprint() TO saas_cook_recovery;
--> statement-breakpoint
CREATE FUNCTION foundation.recovery_credentials(p_epoch uuid,p_mode text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,foundation,identity,tenancy AS $$
DECLARE u record;
BEGIN
 IF p_mode NOT IN ('application','fga-only') THEN RAISE EXCEPTION 'Invalid recovery mode'; END IF;
 IF EXISTS(SELECT 1 FROM foundation.recovery_state WHERE epoch=p_epoch) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(1849202603);
 FOR u IN SELECT id FROM identity."user" ORDER BY id LOOP PERFORM pg_advisory_xact_lock(hashtextextended('user:'||u.id,0)); END LOOP;
 IF p_mode='application' THEN
 UPDATE identity."user" SET lifecycle_status=CASE WHEN lifecycle_status='deleted' THEN 'deleted' ELSE 'frozen' END,credential_epoch=credential_epoch+1,two_factor_enabled=false;
 DELETE FROM identity.session; DELETE FROM identity.account; DELETE FROM identity.passkey; DELETE FROM identity.two_factor; DELETE FROM identity.verification;
 DELETE FROM identity.email_delivery;
 ELSE
 UPDATE identity.session SET recovery_epoch=p_epoch::text;
 UPDATE tenancy.api_keys SET recovery_epoch=p_epoch;
 DELETE FROM identity.verification;
 END IF;
 INSERT INTO foundation.recovery_state(epoch,mode,stage) VALUES(p_epoch,p_mode,'reset');
END $$;
REVOKE ALL ON FUNCTION foundation.recovery_credentials(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.recovery_credentials(uuid,text) TO saas_cook_recovery;
--> statement-breakpoint
CREATE FUNCTION foundation.recovery_enroll(p_user text,p_email text,p_epoch uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,foundation,identity AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM foundation.recovery_state WHERE epoch=p_epoch AND mode='application' AND stage='published') THEN RAISE EXCEPTION 'Recovery not published'; END IF;
 IF EXISTS(SELECT 1 FROM foundation.deletion_requests WHERE subject_kind='account' AND subject_id=p_user AND state NOT IN ('awaiting_prerequisites','canceled')) THEN RAISE EXCEPTION 'Deleted identity cannot be re-enrolled'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('user:'||p_user,0));
 IF EXISTS(SELECT 1 FROM foundation.recovery_enrollments WHERE epoch=p_epoch AND user_id=p_user) THEN
 IF NOT EXISTS(SELECT 1 FROM identity."user" WHERE id=p_user AND email=lower(p_email) AND lifecycle_status='active') THEN RAISE EXCEPTION 'Re-enrollment conflict'; END IF; RETURN; END IF;
 UPDATE identity."user" SET email=lower(p_email),email_verified=true,lifecycle_status='active',credential_epoch=credential_epoch+1 WHERE id=p_user AND lifecycle_status='frozen';
 IF NOT FOUND THEN RAISE EXCEPTION 'Frozen recovery identity required'; END IF;
 INSERT INTO foundation.recovery_enrollments(epoch,user_id) VALUES(p_epoch,p_user);
 INSERT INTO identity.security_audit(id,user_id,action) VALUES(gen_random_uuid(),p_user,'recovery.identity_reverified');
END $$;
REVOKE ALL ON FUNCTION foundation.recovery_enroll(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.recovery_enroll(text,text,uuid) TO saas_cook_recovery;
--> statement-breakpoint
CREATE FUNCTION foundation.recovery_publish(p_epoch uuid,p_store text,p_model text,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,foundation,tenancy AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM foundation.recovery_state WHERE epoch=p_epoch) THEN RAISE EXCEPTION 'Recovery reset required'; END IF;
 UPDATE foundation.installation SET recovery_epoch=p_epoch;
 UPDATE tenancy.authorization_revisions SET recovery_epoch=p_epoch,store_id=p_store,model_id=p_model,model_hash=p_hash,ready=true,applied_revision=desired_revision,updated_at=clock_timestamp();
 UPDATE foundation.recovery_state SET stage='published' WHERE epoch=p_epoch;
END $$;
REVOKE ALL ON FUNCTION foundation.recovery_publish(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.recovery_publish(uuid,text,text,text) TO saas_cook_recovery;
--> statement-breakpoint
CREATE FUNCTION foundation.recovery_verify(p_epoch uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,foundation,tenancy,identity AS $$
 SELECT EXISTS(SELECT 1 FROM foundation.recovery_state WHERE epoch=p_epoch AND stage='published')
 AND EXISTS(SELECT 1 FROM foundation.installation WHERE recovery_epoch=p_epoch)
 AND NOT EXISTS(SELECT 1 FROM tenancy.authorization_revisions WHERE recovery_epoch<>p_epoch OR NOT ready OR desired_revision<>applied_revision)
 AND NOT EXISTS(SELECT 1 FROM foundation.deletion_requests WHERE state IN ('journal_pending','scheduled','purging'))
 AND (EXISTS(SELECT 1 FROM foundation.recovery_state WHERE epoch=p_epoch AND mode='fga-only') OR (
 NOT EXISTS(SELECT 1 FROM tenancy.organizations WHERE status='active')
 AND NOT EXISTS(SELECT 1 FROM tenancy.memberships WHERE status='active' OR seat_counted)
 AND NOT EXISTS(SELECT 1 FROM tenancy.resource_grants)
 AND NOT EXISTS(SELECT 1 FROM tenancy.team_members)
 AND NOT EXISTS(SELECT 1 FROM tenancy.api_keys WHERE revoked_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM tenancy.service_accounts WHERE status='active')
 AND NOT EXISTS(SELECT 1 FROM identity.session)
 AND NOT EXISTS(SELECT 1 FROM identity.account)
 AND NOT EXISTS(SELECT 1 FROM identity.passkey)
 AND NOT EXISTS(SELECT 1 FROM identity.two_factor)
 AND NOT EXISTS(SELECT 1 FROM identity."user" u WHERE lifecycle_status='active' AND NOT EXISTS(SELECT 1 FROM foundation.recovery_enrollments e WHERE e.epoch=p_epoch AND e.user_id=u.id))
 ))
$$;
REVOKE ALL ON FUNCTION foundation.recovery_verify(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foundation.recovery_verify(uuid) TO saas_cook_recovery;
