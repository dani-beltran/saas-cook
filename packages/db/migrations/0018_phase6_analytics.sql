CREATE TABLE "foundation"."analytics_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"event" text NOT NULL,
	"feature" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"synthetic" boolean NOT NULL,
	CONSTRAINT "analytics_event_kind" CHECK (event IN ('account.signed_up','organization.created','onboarding.completed','core_action.completed','subscription.paid_started','subscription.paid_retracted')),
	CONSTRAINT "analytics_event_state" CHECK (state IN ('pending','inflight','delivered','dropped','ambiguous')),
	CONSTRAINT "analytics_feature" CHECK (feature IS NULL OR feature IN ('projects','customers','files','imports','exports'))
);
--> statement-breakpoint
ALTER TABLE "foundation"."analytics_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foundation"."analytics_preferences" (
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "analytics_preferences_subject_kind_subject_id_pk" PRIMARY KEY("subject_kind","subject_id"),
	CONSTRAINT "analytics_preference_subject" CHECK (subject_kind IN ('account','organization'))
);
--> statement-breakpoint
ALTER TABLE "foundation"."analytics_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foundation"."analytics_seen" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "foundation"."analytics_seen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foundation"."analytics_subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid,
	"suppressed" boolean DEFAULT false NOT NULL,
	"deletion_state" text DEFAULT 'none' NOT NULL,
	"receipt" jsonb,
	CONSTRAINT "analytics_deletion_state" CHECK (deletion_state IN ('none','pending','complete'))
);
--> statement-breakpoint
ALTER TABLE "foundation"."analytics_subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "foundation"."analytics_events" ADD CONSTRAINT "analytics_events_subject_id_analytics_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "foundation"."analytics_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_delivery_due" ON "foundation"."analytics_events" USING btree ("state","available_at");--> statement-breakpoint
CREATE INDEX "analytics_subject_user" ON "foundation"."analytics_subjects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_subject_org" ON "foundation"."analytics_subjects" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "migration_control" ON "foundation"."analytics_events" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "analytics_control" ON "foundation"."analytics_events" AS PERMISSIVE FOR ALL TO "saas_cook_lifecycle", "saas_cook_recovery" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "migration_control" ON "foundation"."analytics_preferences" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "analytics_control" ON "foundation"."analytics_preferences" AS PERMISSIVE FOR ALL TO "saas_cook_lifecycle", "saas_cook_recovery" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "migration_control" ON "foundation"."analytics_seen" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "analytics_control" ON "foundation"."analytics_seen" AS PERMISSIVE FOR ALL TO "saas_cook_lifecycle", "saas_cook_recovery" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "migration_control" ON "foundation"."analytics_subjects" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "analytics_control" ON "foundation"."analytics_subjects" AS PERMISSIVE FOR ALL TO "saas_cook_lifecycle", "saas_cook_recovery" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE foundation.analytics_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE foundation.analytics_subjects FORCE ROW LEVEL SECURITY;
ALTER TABLE foundation.analytics_events FORCE ROW LEVEL SECURITY;
ALTER TABLE foundation.analytics_seen FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON foundation.analytics_preferences,foundation.analytics_subjects,foundation.analytics_events,foundation.analytics_seen TO saas_cook_lifecycle,saas_cook_recovery;
