CREATE TABLE "tenancy"."api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_account_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"recovery_epoch" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_keys_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "api_keys_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "api_keys_hash" CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_keys_expiry" CHECK (expires_at > created_at)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."capacity_buckets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"policy_kind" text NOT NULL,
	"capacity" integer,
	"consumed" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "capacity_buckets_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "capacity_buckets_feature" UNIQUE("organization_id","feature"),
	CONSTRAINT "capacity_buckets_counts" CHECK (consumed>=0 AND reserved>=0 AND policy_version>0),
	CONSTRAINT "capacity_buckets_policy" CHECK ((policy_kind='limited' AND capacity>=0) OR (policy_kind IN ('missing','disabled','unlimited') AND capacity IS NULL))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."capacity_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."capacity_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"bucket_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_reservations_operation" UNIQUE("organization_id","bucket_id","operation_key"),
	CONSTRAINT "capacity_reservations_quantity" CHECK (quantity>0),
	CONSTRAINT "capacity_reservations_state" CHECK (state IN ('reserved','committed','released','expired'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."capacity_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_membership_id" uuid,
	"workspace_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "projects_org_slug" UNIQUE("organization_id","slug"),
	CONSTRAINT "projects_name" CHECK (length(name) BETWEEN 1 AND 120),
	CONSTRAINT "projects_description" CHECK (length(description)<=4000),
	CONSTRAINT "projects_slug" CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
	CONSTRAINT "projects_status" CHECK (status IN ('active','completed','archived')),
	CONSTRAINT "projects_version" CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."resource_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"membership_id" uuid,
	"team_id" uuid,
	"service_account_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_grants_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "resource_grants_subject" CHECK (num_nonnulls(membership_id,team_id,service_account_id)=1),
	CONSTRAINT "resource_grants_relation" CHECK (relation IN ('viewer','editor','manager','denied'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."resource_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."resource_operations" (
	"organization_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"operation_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_operations_organization_id_actor_id_operation_operation_key_pk" PRIMARY KEY("organization_id","actor_id","operation","operation_key")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."resource_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."resource_registry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"parent_id" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "resource_registry_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "resource_registry_type" CHECK (resource_type IN ('project','workspace')),
	CONSTRAINT "resource_registry_parent_check" CHECK (parent_id IS NULL OR (resource_type='project' AND parent_id<>id))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."resource_registry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."service_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_accounts_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "service_accounts_name" CHECK (length(name) BETWEEN 1 AND 120),
	CONSTRAINT "service_accounts_status" CHECK (status IN ('active','inactive'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."service_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "workspaces_org_slug" UNIQUE("organization_id","slug"),
	CONSTRAINT "workspaces_name" CHECK (length(name) BETWEEN 1 AND 120),
	CONSTRAINT "workspaces_slug" CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
	CONSTRAINT "workspaces_version" CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_organization_id_service_account_id_service_accounts_organization_id_id_fk" FOREIGN KEY ("organization_id","service_account_id") REFERENCES "tenancy"."service_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."capacity_buckets" ADD CONSTRAINT "capacity_buckets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."capacity_reservations" ADD CONSTRAINT "capacity_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."capacity_reservations" ADD CONSTRAINT "capacity_reservations_organization_id_bucket_id_capacity_buckets_organization_id_id_fk" FOREIGN KEY ("organization_id","bucket_id") REFERENCES "tenancy"."capacity_buckets"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."projects" ADD CONSTRAINT "projects_organization_id_id_resource_registry_organization_id_id_fk" FOREIGN KEY ("organization_id","id") REFERENCES "tenancy"."resource_registry"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."projects" ADD CONSTRAINT "projects_organization_id_owner_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","owner_membership_id") REFERENCES "tenancy"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."projects" ADD CONSTRAINT "projects_organization_id_workspace_id_workspaces_organization_id_id_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "tenancy"."workspaces"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."resource_grants" ADD CONSTRAINT "resource_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."resource_grants" ADD CONSTRAINT "resource_grants_organization_id_resource_id_resource_registry_organization_id_id_fk" FOREIGN KEY ("organization_id","resource_id") REFERENCES "tenancy"."resource_registry"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."resource_grants" ADD CONSTRAINT "resource_grants_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "tenancy"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."resource_grants" ADD CONSTRAINT "resource_grants_organization_id_team_id_teams_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "tenancy"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."resource_grants" ADD CONSTRAINT "resource_grants_organization_id_service_account_id_service_accounts_organization_id_id_fk" FOREIGN KEY ("organization_id","service_account_id") REFERENCES "tenancy"."service_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."resource_operations" ADD CONSTRAINT "resource_operations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."resource_registry" ADD CONSTRAINT "resource_registry_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."resource_registry" ADD CONSTRAINT "resource_registry_organization_id_parent_id_resource_registry_organization_id_id_fk" FOREIGN KEY ("organization_id","parent_id") REFERENCES "tenancy"."resource_registry"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."service_accounts" ADD CONSTRAINT "service_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."workspaces" ADD CONSTRAINT "workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."workspaces" ADD CONSTRAINT "workspaces_organization_id_id_resource_registry_organization_id_id_fk" FOREIGN KEY ("organization_id","id") REFERENCES "tenancy"."resource_registry"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_service" ON "tenancy"."api_keys" USING btree ("organization_id","service_account_id");--> statement-breakpoint
CREATE INDEX "capacity_reservations_expiry" ON "tenancy"."capacity_reservations" USING btree ("organization_id","bucket_id","expires_at");--> statement-breakpoint
CREATE INDEX "projects_list" ON "tenancy"."projects" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "projects_workspace" ON "tenancy"."projects" USING btree ("organization_id","workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "resource_grants_target" ON "tenancy"."resource_grants" USING btree ("organization_id","resource_id");--> statement-breakpoint
CREATE INDEX "resource_grants_member" ON "tenancy"."resource_grants" USING btree ("organization_id","membership_id","resource_id");--> statement-breakpoint
CREATE INDEX "resource_registry_parent" ON "tenancy"."resource_registry" USING btree ("organization_id","parent_id","id");--> statement-breakpoint
CREATE INDEX "workspaces_list" ON "tenancy"."workspaces" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."api_keys" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."api_keys" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."capacity_buckets" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."capacity_buckets" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."capacity_reservations" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."capacity_reservations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."projects" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."projects" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."resource_grants" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."resource_grants" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."resource_operations" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."resource_operations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."resource_registry" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."resource_registry" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."service_accounts" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."service_accounts" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."workspaces" AS PERMISSIVE FOR ALL TO "saas_cook_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."workspaces" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE tenancy.api_keys FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenancy.api_keys TO saas_cook_web, saas_cook_worker;
ALTER TABLE tenancy.capacity_buckets FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenancy.capacity_buckets TO saas_cook_web, saas_cook_worker;
ALTER TABLE tenancy.capacity_reservations FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenancy.capacity_reservations TO saas_cook_web, saas_cook_worker;
ALTER TABLE tenancy.projects FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenancy.projects TO saas_cook_web, saas_cook_worker;
ALTER TABLE tenancy.resource_grants FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenancy.resource_grants TO saas_cook_web, saas_cook_worker;
ALTER TABLE tenancy.resource_operations FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenancy.resource_operations TO saas_cook_web, saas_cook_worker;
ALTER TABLE tenancy.resource_registry FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenancy.resource_registry TO saas_cook_web, saas_cook_worker;
ALTER TABLE tenancy.service_accounts FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenancy.service_accounts TO saas_cook_web, saas_cook_worker;
ALTER TABLE tenancy.workspaces FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON tenancy.workspaces TO saas_cook_web, saas_cook_worker;
GRANT DELETE ON tenancy.resource_grants TO saas_cook_web, saas_cook_worker;
