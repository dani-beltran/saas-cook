CREATE TABLE "tenancy"."example_customer_operations" (
	"organization_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"operation_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "example_customer_operations_organization_id_actor_id_operation_operation_key_pk" PRIMARY KEY("organization_id","actor_id","operation","operation_key"),
	CONSTRAINT "example_customer_operation" CHECK (operation IN ('create','update','delete')),
	CONSTRAINT "example_customer_hash" CHECK (input_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "tenancy"."example_customer_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."example_customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"status" text DEFAULT 'lead' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "example_customers_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "example_customers_name" CHECK (length(btrim(name)) BETWEEN 1 AND 120),
	CONSTRAINT "example_customers_email" CHECK (length(email) BETWEEN 3 AND 254 AND email LIKE '%@%'),
	CONSTRAINT "example_customers_company" CHECK (company IS NULL OR length(btrim(company)) BETWEEN 1 AND 120),
	CONSTRAINT "example_customers_status" CHECK (status IN ('lead','active','inactive')),
	CONSTRAINT "example_customers_version" CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."example_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenancy"."example_customer_operations" ADD CONSTRAINT "example_customer_operations_organization_id_customer_id_example_customers_organization_id_id_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "tenancy"."example_customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."example_customers" ADD CONSTRAINT "example_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "example_customers_created" ON "tenancy"."example_customers" USING btree ("organization_id","created_at","id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "example_customers_name_order" ON "tenancy"."example_customers" USING btree ("organization_id",lower(name) COLLATE "C","id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "example_customers_company_order" ON "tenancy"."example_customers" USING btree ("organization_id",(company IS NULL),coalesce(lower(company),'') COLLATE "C","id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."example_customer_operations" AS PERMISSIVE FOR ALL TO "common_saas_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."example_customer_operations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "migration_control" ON "tenancy"."example_customers" AS PERMISSIVE FOR ALL TO "common_saas_migrator" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."example_customers" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE tenancy.example_customers FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.example_customer_operations FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON tenancy.example_customers TO common_saas_web;
GRANT UPDATE (name,email,company,status,version,updated_at,deleted_at) ON tenancy.example_customers TO common_saas_web;
GRANT SELECT, INSERT ON tenancy.example_customer_operations TO common_saas_web;
-- No DELETE, tenant/ID/timestamp rewrite, identity-role or worker access.
